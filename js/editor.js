// Редактор планировки на SVG. Мировые координаты — сантиметры.
// Комната = внутренний контур; стена рисуется снаружи контура толщиной plan.wallCm.
import {
  ROOM_TYPES, FURNITURE, ROOM_PRESETS, snap, centroid, bounds, asAxisRect, rectPoints,
  edgeLength, fmtArea, fmtLen, summarize, roomArea, furnitureRect, labelPos,
} from './geometry.js';
import { uid } from './db.js';
import { furnitureSymbol, furnitureIcon } from './furniture.js';
import { renderPhoto, loadBitmap, canvasToBlob } from './watermark.js';
import { detectRooms, estimateSkew } from './scan.js';
import { topbar, bindTopbar } from './ui.js';
import { OPENING_TYPES, openingsMarkup, openingMarkup, nearestEdge, snapT } from './openings.js';

const STEP = 10;              // шаг привязки, см
const MIN_ROOM = 30;          // меньше — считаем случайным касанием, см
const TAP_PX = 8;             // сдвиг пальца, который ещё считается тапом
const CLOSE_PX = 22;          // радиус «попадания» в первую точку контура
const STICK_PX = 10;          // на каком расстоянии точка «прилипает» к стене соседней комнаты
const MIN_S = 0.03, MAX_S = 6; // масштаб, пикселей на сантиметр

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pts = (points) => points.map((p) => p.join(',')).join(' ');
const typeOf = (room) => ROOM_TYPES[room.type] || ROOM_TYPES.room;
const roomName = (room) => room.name || typeOf(room).short;

// Прикидка размера подписи: название и площадь в две строки.
function roomLabelPos(room, fs) {
  const chars = Math.max(roomName(room).length, fmtArea(roomArea(room)).length + 3);
  return labelPos(room, (chars * 0.58 + 1) * fs, fs * 2.8);
}

const icon = (body) => `<svg class="tool-ico" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor"
  stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const TOOL_ICONS = {
  select: icon('<path d="M10 2v16M2 10h16M7.5 4.5 10 2l2.5 2.5M7.5 15.5 10 18l2.5-2.5M4.5 7.5 2 10l2.5 2.5M15.5 7.5 18 10l-2.5 2.5"/>'),
  rect: icon('<rect x="3" y="3" width="14" height="14"/><path d="M10 3v6M3 12h7"/>'),
  plot: icon('<path d="M3 6l10-3 4 9-8 5-6-4z" stroke-dasharray="2.5 2.5"/>'),
  door: icon('<path d="M2 17h4M4 17V3M4 3a14 14 0 0 1 13 14" /><path d="M9 17h9"/>'),
  window: icon('<rect x="2" y="7" width="16" height="6"/><path d="M2 10h16"/>'),
};
const SANITARY_CHOICES = [
  { keys: 'combo', label: 'Совмещённый', note: '2,0×2,0 м, с унитазом' },
  { keys: 'wc,bath', label: 'Раздельный', note: 'туалет и ванная' },
];
const presetSize = (p) => [p.w, p.h].map((v) => (v / 100).toFixed(1).replace('.', ',')).join('×') + ' м';

// Мебель: условный знак (вид сверху) поверх заливки комнаты.
function furnitureMarkup(plan, px = () => 1, attrs = () => '') {
  let out = '';
  for (const room of plan.rooms) {
    for (const item of room.furniture || []) {
      const r = furnitureRect(room, item);
      if (!r) continue;
      const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
      out += `<g transform="translate(${cx} ${cy}) rotate(${r.rot}) translate(${-r.lw / 2} ${-r.lh / 2})" fill="#fffdf8"
        stroke="#3a403d" stroke-width="${px(1.3)}" stroke-linejoin="round" ${attrs(item, room)}>
        <rect width="${r.lw}" height="${r.lh}" fill="transparent" stroke="none"/>${furnitureSymbol(item.type, r.lw, r.lh)}</g>`;
    }
  }
  return out;
}

function plotMarkup(plan, px = () => 1) {
  if (!plan.plot || plan.plot.length < 3) return '';
  return `<polygon points="${pts(plan.plot)}" fill="#dcebda" fill-opacity=".55"
    stroke="#6f9c6a" stroke-width="${px(2.5)}" stroke-dasharray="${px(10)} ${px(6)}" stroke-linejoin="round"/>`;
}

function wallsAndFills(plan, attrs = () => '', openingOpts, furniture = furnitureMarkup(plan)) {
  const walls = plan.rooms.map((r) =>
    `<polygon points="${pts(r.points)}" fill="none" stroke="#2b2f2d" stroke-width="${plan.wallCm * 2}" stroke-linejoin="miter"/>`).join('');
  const fills = plan.rooms.map((r) =>
    `<polygon points="${pts(r.points)}" fill="${typeOf(r).fill}" ${attrs(r)}/>`).join('');
  return walls + fills + furniture + openingsMarkup(plan, openingOpts);
}

const allPoints = (plan) => plan.rooms.flatMap((r) => r.points).concat(plan.plot || []);

export function planThumbnail(plan) {
  if (!plan.rooms.length) return '<svg class="thumb" viewBox="0 0 4 3" aria-hidden="true"></svg>';
  const b = bounds(allPoints(plan));
  const pad = plan.wallCm + 60;
  const vb = [b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2].join(' ');
  return `<svg class="thumb" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${plotMarkup(plan)}${wallsAndFills(plan)}</svg>`;
}

// Самостоятельный SVG плана с подписями — для PDF. Возвращает { svg, width, height } в см.
export function planSvg(plan) {
  if (!plan.rooms.length) return null;
  const b = bounds(allPoints(plan));
  const pad = plan.wallCm + 20;
  const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
  const fs = Math.max(w, h) / 38;
  const labels = plan.rooms.map((room) => {
    const [cx, cy] = roomLabelPos(room, fs);
    return `<text x="${cx}" y="${cy}" text-anchor="middle" font-family="-apple-system, 'Segoe UI', Roboto, Arial, sans-serif"
      font-size="${fs}" fill="#1d2321"><tspan x="${cx}" dy="${-fs * 0.15}">${esc(roomName(room))}</tspan>
      <tspan x="${cx}" dy="${fs * 1.2}" font-weight="700">${fmtArea(roomArea(room))} м²</tspan></text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.minX - pad} ${b.minY - pad} ${w} ${h}"
    width="${w}" height="${h}">${plotMarkup(plan)}${wallsAndFills(plan, undefined, undefined, furnitureMarkup(plan, (n) => n * Math.max(w, h) / 700))}${labels}</svg>`;
  return { svg, width: w, height: h };
}

export function openEditor(root, project, { onSave, toast }) {
  const plan = project.plan;
  plan.openings ??= [];
  let tool = 'select';
  let selectedId = null;
  let selectedOpening = null;
  let selectedFurn = null;
  let ghost = null;        // где встанет дверь/окно (превью под курсором)
  let calib = null;        // точки калибровки масштаба подложки
  let underlayUrl = project.underlay?.blob ? URL.createObjectURL(project.underlay.blob) : null;
  const underlayOn = () => !!(underlayUrl && project.underlay.visible !== false);
  let view = { x: 0, y: 0, s: 1 };
  let draft = null;        // точки строящегося контура
  let sanitaryOpen = false; // открыт ли выбор совмещённого или раздельного санузла
  let hover = null;        // точка под курсором (для превью)
  let gesture = null;
  let pending = null;      // снимок до начала изменения
  const history = [];
  const future = [];
  const pointers = new Map();
  let saveTimer = null;
  let userMovedView = false;

  root.innerHTML = `
    <div class="editor">
      ${topbar(project, 'plan', '<button class="btn sheet-toggle" id="sheet" aria-label="Комнаты и площади">☰</button>')}
      <div class="canvas-wrap">
        <svg id="svg" aria-label="Планировка"><g id="world"></g></svg>
        <button class="sel-chip" id="sel-chip" hidden></button>
        <div class="hint" id="hint"></div>
        <div class="tools" role="toolbar">
          <button class="btn" data-tool="select" title="Выбрать и двигать">${TOOL_ICONS.select}Выбор</button>
          <button class="btn" data-tool="rect" title="Прямоугольная комната">${TOOL_ICONS.rect}Комната</button>
          <button class="btn" data-tool="plot" title="Границы участка — рисуются на заднем плане">${TOOL_ICONS.plot}Участок</button>
          <button class="btn" data-tool="door" title="Поставить дверь на стену">${TOOL_ICONS.door}Дверь</button>
          <button class="btn" data-tool="window" title="Поставить окно на стену">${TOOL_ICONS.window}Окно</button>
          <button class="btn primary" id="finish" hidden>Готово</button>
        </div>
        <div class="tools side-tools" role="toolbar" aria-label="История и вид">
          <button class="btn" id="undo" title="Отменить (Ctrl+Z)" aria-label="Отменить">↶</button>
          <button class="btn" id="redo" title="Вернуть (Ctrl+Shift+Z)" aria-label="Вернуть">↷</button>
          <button class="btn" id="fit" title="Показать весь план" aria-label="Показать весь план">⤢</button>
        </div>
      </div>
      <aside class="panel" id="panel"></aside>
    </div>`;

  const $ = (sel) => root.querySelector(sel);
  const editorEl = $('.editor');
  const svg = $('#svg');
  const world = $('#world');
  const panel = $('#panel');
  const hint = $('#hint');

  // Выбранная мебель и комната, в которой она стоит.
  function findFurn(id) {
    if (!id) return null;
    for (const room of plan.rooms) {
      const item = room.furniture?.find((f) => f.id === id);
      if (item) return { room, item };
    }
    return null;
  }

  // ---------- сохранение и история ----------
  const snapshot = () => JSON.stringify({ rooms: plan.rooms, openings: plan.openings, wallCm: plan.wallCm, plot: plan.plot || null });
  function restore(json) {
    const s = JSON.parse(json);
    plan.rooms = s.rooms;
    plan.openings = s.openings || [];
    plan.wallCm = s.wallCm;
    if (s.plot) plan.plot = s.plot; else delete plan.plot;
    if (!plan.rooms.some((r) => r.id === selectedId)) selectedId = null;
    if (!plan.openings.some((o) => o.id === selectedOpening)) selectedOpening = null;
    if (!findFurn(selectedFurn)) selectedFurn = null;
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 300);
  }
  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    return onSave(project);
  }
  function begin() { pending = snapshot(); }
  function commit() {
    if (pending == null) return;
    if (pending !== snapshot()) {
      history.push(pending);
      if (history.length > 100) history.shift();
      future.length = 0;
      scheduleSave();
    }
    pending = null;
    renderAll();
  }
  function change(fn) { begin(); fn(); commit(); }
  function undo() {
    if (!history.length) return;
    future.push(snapshot());
    restore(history.pop());
    scheduleSave();
    renderAll();
  }
  function redo() {
    if (!future.length) return;
    history.push(snapshot());
    restore(future.pop());
    scheduleSave();
    renderAll();
  }

  // ---------- вид ----------
  function toWorld(clientX, clientY) {
    const r = svg.getBoundingClientRect();
    return [(clientX - r.left) / view.s + view.x, (clientY - r.top) / view.s + view.y];
  }
  // Привязка: сначала к стенам других комнат (вплотную через толщину стены или по линии),
  // иначе к сетке. guides — направляющие, которые показываем, пока точка «прилипла».
  let guides = [];
  // near — область, где стоит точка/комната: «вплотную через стену» — для комнат, которые
  // лежат рядом по другой оси; выравнивание «по линии» — для дальних.
  function stickTargets(excludeId, own = [], near = null) {
    const xs = [], ys = [], w = plan.wallCm;
    const pad = w + STICK_PX / view.s;
    for (const r of plan.rooms) {
      if (r.id === excludeId) continue;
      const b = bounds(r.points);
      const besideX = !near || (near.minY <= b.maxY + pad && near.maxY >= b.minY - pad);
      const besideY = !near || (near.minX <= b.maxX + pad && near.maxX >= b.minX - pad);
      // Рядом стоящую комнату не выравниваем «по линии» — иначе комнаты наедут друг на друга.
      for (const [x, y] of r.points) {
        if (besideX) xs.push(x - w, x + w); else xs.push(x);
        if (besideY) ys.push(y - w, y + w); else ys.push(y);
      }
    }
    for (const [x, y] of own) { xs.push(x); ys.push(y); }
    return { xs, ys };
  }
  function nearest(v, cands, tol) {
    let best = null;
    for (const c of cands) { const d = Math.abs(c - v); if (d <= tol && (best == null || d < Math.abs(best - v))) best = c; }
    return best;
  }
  function snapPt(p, excludeId = null, own = []) {
    const { xs, ys } = stickTargets(excludeId, own, { minX: p[0], maxX: p[0], minY: p[1], maxY: p[1] });
    const tol = STICK_PX / view.s;
    const sx = nearest(p[0], xs, tol), sy = nearest(p[1], ys, tol);
    guides = [];
    if (sx != null) guides.push({ x: sx });
    if (sy != null) guides.push({ y: sy });
    return [sx ?? snap(p[0], STEP), sy ?? snap(p[1], STEP)];
  }
  // Тянем сторону мебели: противоположная остаётся на месте, размер меняется шагом 5 см,
  // сторона прилипает к стенам комнаты.
  function resizeFurniture({ room, item }, g, w) {
    const { orig, side } = g;
    const b = bounds(room.points);
    const horizontal = side === 'l' || side === 'r';
    const lo = horizontal ? orig.x : orig.y;
    const hi = lo + (horizontal ? orig.w : orig.h);
    const delta = horizontal ? w[0] - g.start[0] : w[1] - g.start[1];
    const moving = side === 'l' || side === 't' ? lo : hi;
    const walls = horizontal ? [b.minX, b.maxX] : [b.minY, b.maxY];
    const stuck = nearest(moving + delta, walls, STICK_PX / view.s);
    let size = side === 'l' || side === 't' ? hi - (stuck ?? moving + delta) : (stuck ?? moving + delta) - lo;
    if (stuck == null) size = snap(size, 5);
    size = Math.min(1000, Math.max(10, Math.round(size)));
    const start = side === 'l' || side === 't' ? hi - size : lo;
    // На плане ширина и глубина меняются местами, если мебель повёрнута на 90°.
    const key = (orig.rot % 180 ? !horizontal : horizontal) ? 'w' : 'h';
    item[key] = size;
    item.x = horizontal ? start + size / 2 : orig.x + orig.w / 2;
    item.y = horizontal ? orig.y + orig.h / 2 : start + size / 2;
  }

  // Сдвиг стены параллельно самой себе: соседние стены удлиняются или укорачиваются.
  // Прямая стена прилипает к соседям и к сетке, наклонная двигается шагом сетки.
  function movedEdge(orig, i, rawDx, rawDy, excludeId) {
    const n = orig.length;
    const j = (i + 1) % n;
    const a = orig[i], b = orig[j];
    const len = edgeLength(a, b);
    const nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
    const raw = rawDx * nx + rawDy * ny;
    const others = orig.filter((_, k) => k !== i && k !== j);
    const vertical = Math.abs(a[0] - b[0]) < 1, horizontal = Math.abs(a[1] - b[1]) < 1;

    let d = snap(raw, STEP), guide = null;
    guides = [];
    if (vertical || horizontal) {
      const near = bounds([a, b].map(([x, y]) => [x + nx * raw, y + ny * raw]));
      const { xs, ys } = stickTargets(excludeId, others, near);
      const k = vertical ? 0 : 1, sign = vertical ? nx : ny;
      const pos = a[k] + sign * raw;
      const stuck = nearest(pos, vertical ? xs : ys, STICK_PX / view.s);
      d = ((stuck ?? snap(pos, STEP)) - a[k]) * sign;
      if (stuck != null) guide = vertical ? { x: stuck } : { y: stuck };
    }

    // Соседние стены не должны вывернуться или стать короче минимума.
    let lo = -Infinity, hi = Infinity;
    for (const [from, to] of [[orig[(i - 1 + n) % n], a], [orig[(j + 1) % n], b]]) {
      const along = (to[0] - from[0]) * nx + (to[1] - from[1]) * ny;
      if (along >= 1) lo = Math.max(lo, Math.min(0, MIN_ROOM - along));
      else if (along <= -1) hi = Math.min(hi, Math.max(0, -along - MIN_ROOM));
    }
    const clamped = Math.min(hi, Math.max(lo, d));
    if (guide && clamped === d) guides.push(guide);
    return orig.map((p, k) => (k === i || k === j
      ? [Math.round(p[0] + nx * clamped), Math.round(p[1] + ny * clamped)]
      : p));
  }
  // Сдвиг комнаты целиком: шаг сетки, плюс доводка, чтобы стена встала вплотную к соседней.
  function snapMove(orig, rawDx, rawDy, excludeId) {
    let dx = snap(rawDx, STEP), dy = snap(rawDy, STEP);
    const b = bounds(orig);
    const { xs, ys } = stickTargets(excludeId, [], { minX: b.minX + rawDx, maxX: b.maxX + rawDx, minY: b.minY + rawDy, maxY: b.maxY + rawDy });
    const tol = STICK_PX / view.s;
    const fit = (vals, cands, d) => {
      let best = null;
      for (const v of vals) for (const c of cands) {
        const diff = c - (v + d);
        if (Math.abs(diff) <= tol && (best == null || Math.abs(diff) < Math.abs(best.diff))) best = { diff, c };
      }
      return best;
    };
    guides = [];
    const bx = fit([...new Set(orig.map((p) => p[0]))], xs, rawDx);
    const by = fit([...new Set(orig.map((p) => p[1]))], ys, rawDy);
    if (bx) { dx = rawDx + bx.diff; guides.push({ x: bx.c }); }
    if (by) { dy = rawDy + by.diff; guides.push({ y: by.c }); }
    return [dx, dy];
  }

  function fit() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const all = plan.rooms.flatMap((x) => x.points).concat(plan.plot || []);
    if (underlayOn()) {
      const u = project.underlay;
      all.push([u.x, u.y], [u.x + u.w * u.scale, u.y + u.h * u.scale]);
    }
    const b = all.length ? bounds(all) : { minX: 0, minY: 0, maxX: 800, maxY: 600 };
    const pad = plan.wallCm + 80;
    const w = b.maxX - b.minX + pad * 2, h = b.maxY - b.minY + pad * 2;
    // На телефоне снизу панель инструментов — оставляем под неё место.
    const usableH = r.height - 70;
    view.s = Math.min(MAX_S, Math.max(MIN_S, Math.min(r.width / w, usableH / h)));
    view.x = (b.minX + b.maxX) / 2 - r.width / 2 / view.s;
    view.y = (b.minY + b.maxY) / 2 - usableH / 2 / view.s;
    render();
  }

  function zoomAt(clientX, clientY, factor) {
    userMovedView = true;
    const [wx, wy] = toWorld(clientX, clientY);
    const s = Math.min(MAX_S, Math.max(MIN_S, view.s * factor));
    const r = svg.getBoundingClientRect();
    view.s = s;
    view.x = wx - (clientX - r.left) / s;
    view.y = wy - (clientY - r.top) / s;
    render();
  }

  // ---------- отрисовка холста ----------
  function render() {
    const r = svg.getBoundingClientRect();
    const s = view.s;
    const px = (n) => n / s;   // экранные пиксели → сантиметры
    const g = s < 0.06 ? 500 : s < 0.25 ? 100 : 50;
    let html = `
      <defs><pattern id="grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse">
        <path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="#e5ddcc" stroke-width="${px(1)}"/>
      </pattern></defs>
      <rect x="${view.x}" y="${view.y}" width="${r.width / s}" height="${r.height / s}" fill="url(#grid)"/>`;

    if (underlayOn()) {
      const u = project.underlay;
      html += `<image href="${underlayUrl}" x="${u.x}" y="${u.y}" width="${u.w * u.scale}" height="${u.h * u.scale}"
        opacity="${u.opacity ?? 0.6}" preserveAspectRatio="none" pointer-events="none"/>`;
      html += '<g opacity=".72">';
    }
    // Участок всегда на заднем слое: лёгкая заливка + пунктирная граница.
    if (plan.plot && plan.plot.length >= 3) {
      html += `<polygon points="${pts(plan.plot)}" fill="#dcebda" fill-opacity=".55"
        stroke="#6f9c6a" stroke-width="${px(2.5)}" stroke-dasharray="${px(10)} ${px(6)}"
        stroke-linejoin="round" pointer-events="none"/>`;
    }
    html += wallsAndFills(plan, (room) => `data-room="${room.id}" style="cursor:${tool === 'select' ? 'move' : 'crosshair'}"`,
      (o) => ({ selected: o.id === selectedOpening, attrs: tool === 'select' ? `data-opening="${o.id}" style="cursor:ew-resize"` : '' }),
      furnitureMarkup(plan, px,
        (item, room) => (tool === 'select' ? `data-furn="${item.id}" data-froom="${room.id}" style="cursor:grab"` : 'pointer-events="none"')));
    if (underlayOn()) html += '</g>';
    if (ghost) html += openingMarkup(plan, ghost, { ghost: true });

    // подписи комнат
    const fs = px(13);
    for (const room of plan.rooms) {
      const [cx, cy] = roomLabelPos(room, fs);
      html += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs}" fill="#1d2321"
        stroke="#fffdf8" stroke-width="${px(3)}" paint-order="stroke" pointer-events="none">
        <tspan x="${cx}" dy="${-fs * 0.2}">${esc(roomName(room))}</tspan>
        <tspan x="${cx}" dy="${fs * 1.25}" font-weight="600">${fmtArea(roomArea(room))} м²</tspan></text>`;
    }

    // выбранная мебель: рамка и размеры
    const furnSel = findFurn(selectedFurn);
    if (furnSel) {
      const r = furnitureRect(furnSel.room, furnSel.item);
      const dim = (x, y, value) => `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${px(12)}"
        fill="#a35a12" stroke="#faf7f1" stroke-width="${px(3)}" paint-order="stroke" pointer-events="none">${value} см</text>`;
      html += `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" fill="none" stroke="#d9822b"
        stroke-width="${px(2.5)}" stroke-dasharray="${px(7)} ${px(4)}" pointer-events="none"/>`
        + dim(r.x + r.w / 2, r.y - px(26), Math.round(r.w))
        + dim(r.x + r.w + px(40), r.y + r.h / 2, Math.round(r.h));
      if (tool === 'select') {
        // Зона захвата лежит снаружи стороны: внутри мебель по-прежнему просто двигается.
        const off = px(9), hit = px(18);
        const sides = [
          ['l', r.x - off, r.y, r.x - off, r.y + r.h, 'ew-resize'],
          ['r', r.x + r.w + off, r.y, r.x + r.w + off, r.y + r.h, 'ew-resize'],
          ['t', r.x, r.y - off, r.x + r.w, r.y - off, 'ns-resize'],
          ['b', r.x, r.y + r.h + off, r.x + r.w, r.y + r.h + off, 'ns-resize'],
        ];
        for (const [side, x1, y1, x2, y2, cursor] of sides) {
          html += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="transparent" stroke-width="${hit}"
            data-fedge="${side}" style="cursor:${cursor}"/>`;
        }
        const pill = (cx, cy, vertical) => {
          const a = px(16), b = px(6);
          const w = vertical ? b : a, h = vertical ? a : b;
          return `<rect x="${cx - w / 2}" y="${cy - h / 2}" width="${w}" height="${h}" rx="${b / 2}" fill="#fff"
            stroke="#d9822b" stroke-width="${px(2)}" pointer-events="none"/>`;
        };
        html += pill(r.x, r.y + r.h / 2, true) + pill(r.x + r.w, r.y + r.h / 2, true)
          + pill(r.x + r.w / 2, r.y, false) + pill(r.x + r.w / 2, r.y + r.h, false);
      }
    }

    // выбранная комната: обводка, размеры стен, ручки углов
    const sel = plan.rooms.find((x) => x.id === selectedId);
    if (sel) {
      html += `<polygon points="${pts(sel.points)}" fill="none" stroke="#d9822b" stroke-width="${px(2.5)}" pointer-events="none"/>`;
      const [cx, cy] = centroid(sel.points);
      sel.points.forEach((a, i) => {
        const b = sel.points[(i + 1) % sel.points.length];
        const len = edgeLength(a, b);
        if (len < 1) return;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len;
        if ((cx - mx) * nx + (cy - my) * ny > 0) { nx = -nx; ny = -ny; } // наружу
        const off = plan.wallCm + px(14);
        html += `<text x="${mx + nx * off}" y="${my + ny * off}" text-anchor="middle" dominant-baseline="middle"
          font-size="${px(12)}" fill="#a35a12" stroke="#faf7f1" stroke-width="${px(3)}" paint-order="stroke"
          pointer-events="none">${fmtLen(len)}</text>`;
        if (tool !== 'select') return;
        const hx = nx * plan.wallCm / 2, hy = ny * plan.wallCm / 2;
        const cursor = Math.abs(a[0] - b[0]) < 1 ? 'ew-resize' : Math.abs(a[1] - b[1]) < 1 ? 'ns-resize' : 'move';
        html += `<line x1="${a[0] + hx}" y1="${a[1] + hy}" x2="${b[0] + hx}" y2="${b[1] + hy}" stroke="transparent"
          stroke-width="${Math.max(plan.wallCm, px(28))}" data-edge="${i}" style="cursor:${cursor}"/>`;
        if (len * s >= 60) {
          const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
          html += `<rect x="${mx - px(11)}" y="${my - px(3.5)}" width="${px(22)}" height="${px(7)}" rx="${px(3.5)}"
            transform="rotate(${angle} ${mx} ${my})" fill="#fff" stroke="#d9822b" stroke-width="${px(2)}" pointer-events="none"/>`;
        }
      });
      if (tool === 'select') {
        sel.points.forEach((p, i) => {
          html += `<circle cx="${p[0]}" cy="${p[1]}" r="${px(18)}" fill="transparent" data-vertex="${i}" style="cursor:grab"/>
            <circle cx="${p[0]}" cy="${p[1]}" r="${px(6)}" fill="#fff" stroke="#d9822b" stroke-width="${px(2.5)}" pointer-events="none"/>`;
        });
      }
    }

    // превью прямоугольника
    if (gesture?.type === 'rect') {
      const [x1, y1] = gesture.start, [x2, y2] = gesture.end;
      const x = Math.min(x1, x2), y = Math.min(y1, y2), w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      html += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(31,95,91,.12)" stroke="#1f5f5b"
        stroke-width="${px(2)}" stroke-dasharray="${px(6)} ${px(4)}"/>`;
      if (w && h) {
        html += `<text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" dominant-baseline="middle" font-size="${px(14)}"
          font-weight="600" fill="#1f5f5b" stroke="#faf7f1" stroke-width="${px(3)}" paint-order="stroke">
          ${fmtLen(w)} × ${fmtLen(h)} = ${fmtArea(w * h / 10000)} м²</text>`;
      }
    }

    // превью контура
    if (draft) {
      const line = hover && !gesture?.moved ? [...draft, hover] : draft;
      html += `<polyline points="${pts(line)}" fill="rgba(31,95,91,.10)" stroke="#1f5f5b" stroke-width="${px(2)}"/>`;
      draft.forEach((p, i) => {
        html += `<circle cx="${p[0]}" cy="${p[1]}" r="${px(i === 0 && draft.length >= 3 ? 9 : 5)}"
          fill="${i === 0 ? '#1f5f5b' : '#fff'}" stroke="#1f5f5b" stroke-width="${px(2)}"/>`;
      });
      if (hover && draft.length) {
        const last = draft[draft.length - 1];
        const len = edgeLength(last, hover);
        if (len) html += `<text x="${hover[0] + px(12)}" y="${hover[1] - px(12)}" font-size="${px(13)}" fill="#1f5f5b"
          stroke="#faf7f1" stroke-width="${px(3)}" paint-order="stroke">${fmtLen(len)} м</text>`;
      }
    } else if (hover && tool !== 'select') {
      html += `<circle cx="${hover[0]}" cy="${hover[1]}" r="${px(4)}" fill="#1f5f5b"/>`;
    }

    for (const gl of guides) {
      const attrs = `stroke="#1f5f5b" stroke-width="${px(1)}" stroke-dasharray="${px(5)} ${px(4)}" pointer-events="none"`;
      html += 'x' in gl
        ? `<line x1="${gl.x}" y1="${view.y}" x2="${gl.x}" y2="${view.y + r.height / s}" ${attrs}/>`
        : `<line x1="${view.x}" y1="${gl.y}" x2="${view.x + r.width / s}" y2="${gl.y}" ${attrs}/>`;
    }
    if (calib?.length) {
      const [a, b] = calib;
      if (b) html += `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#d9822b" stroke-width="${px(3)}"/>`;
      for (const p of calib) {
        html += `<circle cx="${p[0]}" cy="${p[1]}" r="${px(7)}" fill="#fff" stroke="#d9822b" stroke-width="${px(3)}"/>`;
      }
    }

    world.setAttribute('transform', `matrix(${s} 0 0 ${s} ${-view.x * s} ${-view.y * s})`);
    world.innerHTML = html;

    $('#undo').disabled = !history.length;
    $('#redo').disabled = !future.length;
    $('#finish').hidden = !(draft && draft.length >= 3);
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    hint.textContent = hintText();
    // На телефоне свойства выделенного — в выезжающей панели; чип подсказывает, что она есть.
    const chip = $('#sel-chip');
    const selRoom = plan.rooms.find((x) => x.id === selectedId);
    const selOp = plan.openings.find((o) => o.id === selectedOpening);
    const selFurn = findFurn(selectedFurn);
    chip.hidden = !(selRoom || selOp || selFurn) || editorEl.classList.contains('sheet-open');
    if (selRoom) chip.textContent = `${roomName(selRoom)} · ${fmtArea(roomArea(selRoom))} м² — изменить`;
    else if (selOp) chip.textContent = `${OPENING_TYPES[selOp.type]?.label || 'Проём'} ${selOp.width} см — изменить`;
    else if (selFurn) {
      const r = furnitureRect(selFurn.room, selFurn.item);
      chip.textContent = `${FURNITURE[selFurn.item.type]?.label || 'Мебель'} ${r.lw}×${r.lh} см — изменить`;
    }
  }

  function hintText() {
    if (tool === 'rect') return 'Проведите пальцем по диагонали комнаты';
    if (tool === 'plot') {
      if (!draft) return 'Нажимайте по углам участка. Заливка уйдёт под чертёж дома';
      return draft.length >= 3 ? 'Нажмите на первую точку, чтобы замкнуть участок' : 'Следующий угол участка…';
    }
    if (tool === 'calib') {
      return calib?.length ? 'Теперь нажмите на другой конец этой стены' : 'Нажмите на один конец стены, длину которой знаете';
    }
    if (tool === 'door' || tool === 'window') {
      return plan.rooms.length ? `Нажмите на стену, где должно быть ${tool === 'door' ? 'дверь' : 'окно'}` : 'Сначала нарисуйте комнату';
    }
    if (!plan.rooms.length) return 'Начните с инструмента «Комната»';
    return '';
  }

  // ---------- панель ----------
  function renderPanel() {
    const sum = summarize(plan.rooms);
    const sel = plan.rooms.find((x) => x.id === selectedId);
    const rect = sel && asAxisRect(sel.points);
    const typeOptions = (cur) => Object.entries(ROOM_TYPES)
      .map(([k, t]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${t.label}</option>`).join('');

    const op = plan.openings.find((o) => o.id === selectedOpening);
    const furnSel = findFurn(selectedFurn);
    const furnRect = furnSel && furnitureRect(furnSel.room, furnSel.item);
    const furnRoom = sel || furnSel?.room;
    panel.innerHTML = `
      ${furnSel ? `
        <h2>${FURNITURE[furnSel.item.type]?.label || 'Мебель'}</h2>
        <div class="row">
          <label class="field">Ширина, см<input id="f-w" type="number" inputmode="numeric" min="10" max="1000" step="1" value="${furnRect.lw}"></label>
          <label class="field">Глубина, см<input id="f-h" type="number" inputmode="numeric" min="10" max="1000" step="1" value="${furnRect.lh}"></label>
        </div>
        <div class="row">
          <button class="btn" id="f-rot">Повернуть на 90°</button>
          ${furnSel.item.w != null || furnSel.item.h != null ? '<button class="btn" id="f-reset">Как в шаблоне</button>' : ''}
        </div>
        <p class="muted">Чтобы сдвинуть, потяните мебель по плану.</p>
        <div class="row"><button class="btn danger" id="f-del">Удалить</button></div>
      ` : ''}
      ${op ? `
        <h2>${OPENING_TYPES[op.type]?.label || 'Проём'}</h2>
        <label class="field">Тип<select id="o-type">${Object.entries(OPENING_TYPES)
          .map(([k, t]) => `<option value="${k}" ${k === op.type ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
        <label class="field">Ширина, см<input id="o-w" type="number" inputmode="numeric" min="30" max="400" step="5" value="${op.width}"></label>
        ${op.type === 'door' ? `<div class="row">
          <button class="btn" id="o-swing" title="Открывается ${op.swing === 'out' ? 'наружу' : 'внутрь'} комнаты">${op.swing === 'out' ? 'Наружу' : 'Внутрь'} ⇅</button>
          <button class="btn" id="o-hinge">Петли ⇄</button>
        </div>` : ''}
        <p class="muted">Чтобы сдвинуть, потяните ${op.type === 'window' ? 'окно' : 'дверь'} вдоль стены или на другую стену.</p>
        <div class="row"><button class="btn danger" id="o-del">Удалить</button></div>
      ` : ''}
      ${sel ? `
        <h2>Выбранная комната</h2>
        <label class="field">Тип<select id="r-type">${typeOptions(sel.type)}</select></label>
        <label class="field">Название<input id="r-name" value="${esc(sel.name)}" placeholder="${esc(typeOf(sel).short)}"></label>
        ${rect ? `<div class="row">
          <label class="field">Ширина, м<input id="r-w" type="number" inputmode="decimal" step="0.01" min="0.3" value="${(rect.w / 100).toFixed(2)}"></label>
          <label class="field">Длина, м<input id="r-h" type="number" inputmode="decimal" step="0.01" min="0.3" value="${(rect.h / 100).toFixed(2)}"></label>
        </div>` : ''}
        <label class="field">Площадь по документам, м²
          <input id="r-area" type="number" inputmode="decimal" step="0.1" min="0" value="${sel.areaOverride ?? ''}"
            placeholder="по чертежу: ${fmtArea(roomArea({ points: sel.points }))}">
        </label>
        <div class="row"><button class="btn danger" id="r-del">Удалить комнату</button></div>
      ` : ''}

      <h2>Добавить комнату</h2>
      <p class="muted">Готовая комната встанет на план целиком — с мебелью. Потом её можно двигать и тянуть за стены.</p>
      <div class="presets">
        ${Object.entries(ROOM_PRESETS).filter(([k]) => k !== 'bath' && k !== 'wc').map(([k, p]) => (k === 'combo' ? `
          <button class="preset" data-sanitary aria-expanded="${sanitaryOpen}">
            <span class="swatch" style="background:${ROOM_TYPES.combo.fill};border-color:${ROOM_TYPES.combo.tone}"></span>
            <span class="nm">Санузел</span>
            <span class="sz">совмещённый или раздельный</span>
          </button>
          ${sanitaryOpen ? `<div class="sanitary-choice">${SANITARY_CHOICES.map((c) => `
            <button class="preset" data-preset="${c.keys}">
              <span class="nm">${c.label}</span>
              <span class="sz">${c.note}</span>
            </button>`).join('')}</div>` : ''}` : `
          <button class="preset" data-preset="${k}">
            <span class="swatch" style="background:${ROOM_TYPES[p.type].fill};border-color:${ROOM_TYPES[p.type].tone}"></span>
            <span class="nm">${p.label}</span>
            <span class="sz">${presetSize(p)}</span>
          </button>`)).join('')}
      </div>

      ${furnRoom ? `<h2>Мебель в комнате</h2>
        ${furnRoom.furniture?.length ? `<ul class="furn-list">
          ${furnRoom.furniture.map((f) => {
            const r = furnitureRect(furnRoom, f);
            return `<li><button class="pick" data-furn-pick="${f.id}" ${f.id === selectedFurn ? 'aria-current="true"' : ''}>${FURNITURE[f.type]?.label || 'Мебель'} <span class="muted">${r.lw}×${r.lh}</span></button>
            <button class="btn ghost danger" data-furn-del="${f.id}">Убрать</button></li>`;
          }).join('')}
        </ul>` : ''}
        <div class="presets">
          ${Object.entries(FURNITURE).map(([k, f]) => `
            <button class="preset sm" data-furn-add="${k}" data-furn-room="${furnRoom.id}">
              ${furnitureIcon(k, f.w, f.h)}
              <span class="nm">${f.label}</span>
              <span class="sz">${f.w}×${f.h} см</span>
            </button>`).join('')}
        </div>` : ''}

      <h2>Площади</h2>
      <dl class="summary">
        <dt>Общая</dt><dd>${fmtArea(sum.total)} м²</dd>
        <dt>Жилая${sum.livingCount ? ` (${sum.livingCount} комн.)` : ''}</dt><dd>${fmtArea(sum.living)} м²</dd>
        <dt>Кухня</dt><dd>${fmtArea(sum.kitchen)} м²</dd>
        ${sum.outdoor ? `<dt>Балконы и лоджии</dt><dd>${fmtArea(sum.outdoor)} м²</dd>` : ''}
      </dl>

      <h2>Комнаты</h2>
      ${plan.rooms.length ? `<ul class="rooms">${plan.rooms.map((r) => `
        <li><button data-pick="${r.id}" class="${r.id === selectedId ? 'on' : ''}">
          <span class="swatch" style="background:${typeOf(r).fill}"></span>
          <span class="nm">${esc(roomName(r))}</span>
          <span class="ar">${fmtArea(roomArea(r))} м²</span>
        </button></li>`).join('')}</ul>`
        : '<p class="muted">Комнат пока нет. Выберите «Комната» внизу и проведите по экрану.</p>'}

      <h2>Участок</h2>
      ${plan.plot && plan.plot.length >= 3 ? `
        <p class="muted">Границы участка заданы. Заливка идёт под чертежом дома.</p>
        <div class="row"><button class="btn danger" id="plot-del">Убрать участок</button></div>
      ` : '<p class="muted">Инструмент «Участок» внизу: нажмите по углам участка, чтобы обвести границы. Границы рисуются пунктиром и уходят за чертёж.</p>'}
      <label class="field">Кадастровый номер
        <input id="p-cad" value="${esc(project.cadastral || '')}" placeholder="00:00:0000000:00" inputmode="numeric">
      </label>

      <h2>Подложка: план БТИ или ЕГРН</h2>
      ${underlayUrl ? `
        <label class="check"><input type="checkbox" id="u-on" ${project.underlay.visible !== false ? 'checked' : ''}> Показывать</label>
        <label class="field">Яркость подложки<input type="range" id="u-op" min="15" max="100" value="${Math.round((project.underlay.opacity ?? 0.6) * 100)}"></label>
        <button class="btn primary wide" id="u-scan">Распознать комнаты автоматически</button>
        <div class="row">
          <button class="btn" id="u-calib">Задать масштаб</button>
          <button class="btn danger" id="u-del">Убрать</button>
        </div>
        <p class="muted">Или обведите комнаты сами поверх плана инструментом «Комната».</p>
      ` : `
        <p class="muted">Сфотографируйте план из техпаспорта ровно сверху — он ляжет под чертёж, и комнаты останется обвести.</p>
        <label class="btn">Загрузить фото плана<input type="file" id="u-file" accept="image/*" hidden></label>
      `}

      <h2>Объект</h2>
      <p class="muted">Площадь считается по внутреннему контуру комнаты, как в техпаспорте. Стены рисуются снаружи и в площадь не входят.</p>`;

    panel.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { selectedId = b.dataset.pick; selectedOpening = null; selectedFurn = null; tool = 'select'; renderAll(); };
    });
    panel.querySelectorAll('[data-preset]').forEach((b) => {
      b.onclick = () => addPresets(b.dataset.preset.split(','));
    });
    const sanitaryBtn = panel.querySelector('[data-sanitary]');
    sanitaryBtn.onclick = () => { sanitaryOpen = !sanitaryOpen; renderPanel(); };
    panel.querySelectorAll('[data-furn-add]').forEach((b) => {
      b.onclick = () => addFurniture(b.dataset.furnRoom, b.dataset.furnAdd);
    });
    panel.querySelectorAll('[data-furn-del]').forEach((b) => {
      b.onclick = () => {
        change(() => {
          furnRoom.furniture = furnRoom.furniture.filter((f) => f.id !== b.dataset.furnDel);
          if (selectedFurn === b.dataset.furnDel) { selectedFurn = null; selectedId = furnRoom.id; }
        });
        renderAll();
      };
    });
    panel.querySelectorAll('[data-furn-pick]').forEach((b) => {
      b.onclick = () => { selectedFurn = b.dataset.furnPick; selectedId = null; selectedOpening = null; tool = 'select'; renderAll(); };
    });
    if (furnSel) {
      const setSize = (key, e) => {
        const v = Math.round(Number(e.target.value));
        if (v >= 10 && v <= 1000) change(() => { furnSel.item[key] = v; });
        renderAll();
      };
      $('#f-w').onchange = (e) => setSize('w', e);
      $('#f-h').onchange = (e) => setSize('h', e);
      $('#f-rot').onclick = () => { change(() => { furnSel.item.rot = ((furnSel.item.rot || 0) + 90) % 360; }); renderAll(); };
      const reset = $('#f-reset');
      if (reset) reset.onclick = () => { change(() => { delete furnSel.item.w; delete furnSel.item.h; }); renderAll(); };
      $('#f-del').onclick = () => { deleteSelected(); renderAll(); };
    }
    if (op) {
      $('#o-type').onchange = (e) => change(() => {
        const was = OPENING_TYPES[op.type];
        op.type = e.target.value;
        if (op.width === was?.width) op.width = OPENING_TYPES[op.type].width;
      });
      $('#o-w').onchange = (e) => {
        const v = Math.round(Number(e.target.value));
        if (v >= 30 && v <= 400) change(() => { op.width = v; }); else renderPanel();
      };
      if (op.type === 'door') {
        $('#o-swing').onclick = () => change(() => { op.swing = op.swing === 'out' ? 'in' : 'out'; });
        $('#o-hinge').onclick = () => change(() => { op.hinge = op.hinge === 'b' ? 'a' : 'b'; });
      }
      $('#o-del').onclick = () => deleteSelected();
    }
    if (sel) {
      $('#r-type').onchange = (e) => change(() => { sel.type = e.target.value; });
      $('#r-name').oninput = (e) => { sel.name = e.target.value.trim(); render(); };
      $('#r-name').onfocus = () => begin();
      $('#r-name').onchange = () => commit();
      if (rect) {
        const setSize = (key) => (e) => {
          const v = Math.round(parseFloat(String(e.target.value).replace(',', '.')) * 100);
          if (!(v >= MIN_ROOM)) { renderPanel(); return; }
          change(() => {
            const w = key === 'w' ? v : rect.w, h = key === 'h' ? v : rect.h;
            sel.points = rectPoints(rect.x, rect.y, w, h);
          });
        };
        $('#r-w').onchange = setSize('w');
        $('#r-h').onchange = setSize('h');
      }
      $('#r-area').onchange = (e) => {
        const v = parseFloat(String(e.target.value).replace(',', '.'));
        change(() => { if (v > 0) sel.areaOverride = Math.round(v * 10) / 10; else delete sel.areaOverride; });
      };
      $('#r-del').onclick = () => deleteSelected();
    }
    $('#p-cad').onchange = (e) => { project.cadastral = e.target.value.trim(); scheduleSave(); };
    const plotDel = $('#plot-del');
    if (plotDel) plotDel.onclick = () => { change(() => { delete plan.plot; }); renderAll(); };
    if (underlayUrl) {
      $('#u-on').onchange = (e) => { project.underlay.visible = e.target.checked; scheduleSave(); render(); };
      $('#u-op').oninput = (e) => { project.underlay.opacity = Number(e.target.value) / 100; scheduleSave(); render(); };
      $('#u-calib').onclick = () => { setTool('calib'); editorEl.classList.remove('sheet-open'); };
      $('#u-scan').onclick = () => scanUnderlay();
      $('#u-del').onclick = () => {
        if (!confirm('Убрать подложку? Нарисованные комнаты останутся.')) return;
        URL.revokeObjectURL(underlayUrl);
        underlayUrl = null;
        delete project.underlay;
        if (tool === 'calib') setTool('select');
        scheduleSave();
        renderAll();
      };
    } else {
      $('#u-file').onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try { await setUnderlay(file); } catch { toast?.('Не удалось открыть изображение'); }
      };
    }
  }

  function renderAll() { render(); renderPanel(); }

  // ---------- действия ----------
  function addRoom(points) {
    const room = { id: uid(), type: 'room', name: '', points };
    change(() => { plan.rooms.push(room); selectedId = room.id; selectedOpening = null; selectedFurn = null; });
    toast?.(`Комната ${fmtArea(roomArea(room))} м²`);
  }
  // Ставим готовые комнаты справа от уже нарисованных, вплотную через стену.
  function addPresets(keys) {
    const b = plan.rooms.length ? bounds(plan.rooms.flatMap((r) => r.points)) : null;
    let x = b ? b.maxX + plan.wallCm : 0;
    const y = b ? b.minY : 0;
    const rooms = keys.map((key) => {
      const preset = ROOM_PRESETS[key];
      const room = {
        id: uid(),
        type: preset.type,
        name: '',
        points: rectPoints(x, y, preset.w, preset.h),
        furniture: (preset.furniture || []).map((f) => ({ id: uid(), ...f })),
      };
      x += preset.w + plan.wallCm;
      return room;
    });
    sanitaryOpen = false;
    change(() => { plan.rooms.push(...rooms); selectedId = rooms[rooms.length - 1].id; selectedFurn = null; });
    fit();
    toast?.(keys.map((k, i) => `${ROOM_PRESETS[k].label} — ${fmtArea(roomArea(rooms[i]))} м²`).join(', '));
  }

  function addFurniture(roomId, type) {
    const room = plan.rooms.find((r) => r.id === roomId);
    const f = FURNITURE[type];
    if (!room || !f) return;
    const item = { id: uid(), type, anchor: 'center' };
    change(() => {
      room.furniture ??= [];
      room.furniture.push(item);
      selectedFurn = item.id;
      selectedId = null;
      selectedOpening = null;
    });
    renderAll();
  }

  function deleteSelected() {
    const furnSel = findFurn(selectedFurn);
    if (furnSel) {
      change(() => {
        furnSel.room.furniture = furnSel.room.furniture.filter((f) => f.id !== selectedFurn);
        selectedFurn = null;
        selectedId = furnSel.room.id;
      });
      return;
    }
    if (selectedOpening) {
      change(() => { plan.openings = plan.openings.filter((o) => o.id !== selectedOpening); selectedOpening = null; });
      return;
    }
    if (!selectedId) return;
    change(() => {
      plan.rooms = plan.rooms.filter((r) => r.id !== selectedId);
      plan.openings = plan.openings.filter((o) => o.roomId !== selectedId);
      selectedId = null;
    });
  }
  // Привязка к стене под точкой (мировые координаты) для нового или перетаскиваемого проёма.
  function edgeAt(w) {
    const hit = nearestEdge(plan, w, 24 / view.s);
    return hit && { roomId: hit.roomId, edge: hit.edge, t: snapT(hit.t, hit.len) };
  }
  function addOpening(type, at) {
    const o = { id: uid(), type, ...at, width: OPENING_TYPES[type].width, swing: 'in', hinge: 'a' };
    change(() => { plan.openings.push(o); selectedOpening = o.id; selectedId = null; selectedFurn = null; });
  }
  async function setUnderlay(file) {
    const { blob, w, h } = await renderPhoto(file, { maxSide: 2400, quality: 0.9 });
    const r = svg.getBoundingClientRect();
    // Примерный масштаб: длинная сторона плана ≈ 12 м. Точный задаётся калибровкой.
    const scale = 1200 / Math.max(w, h);
    const [cx, cy] = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    project.underlay = { blob, w, h, scale, x: cx - (w * scale) / 2, y: cy - (h * scale) / 2, opacity: 0.6, visible: true };
    underlayUrl = URL.createObjectURL(blob);
    scheduleSave();
    userMovedView = false;
    fit();
    setTool('calib');
    editorEl.classList.remove('sheet-open');
    toast?.('Теперь задайте масштаб по одной стене');
  }
  // Автоматическое распознавание комнат по подложке. Результат — обычные комнаты, их можно править.
  let scanning = false;
  async function scanUnderlay() {
    const u = project.underlay;
    if (!u || scanning) return;
    if (!u.calibrated) {
      toast?.('Сначала задайте масштаб: нажмите на концы известной стены');
      setTool('calib');
      editorEl.classList.remove('sheet-open');
      return;
    }
    if (plan.rooms.length && !confirm('Заменить нарисованные комнаты распознанными? Вернуть можно кнопкой ↶.')) return;
    scanning = true;
    editorEl.classList.remove('sheet-open');
    toast?.('Распознаю план…');
    await new Promise((r) => setTimeout(r, 30));
    try {
      // Рабочее разрешение: 1,5–3 см на пиксель — хватает для стен и быстро считается.
      const c = Math.max(u.scale, (Math.max(u.w, u.h) * u.scale) / 1000, 1.5);
      const W = Math.round((u.w * u.scale) / c), H = Math.round((u.h * u.scale) / c);
      const grayOf = (src) => {
        const cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(src, 0, 0, W, H);
        const d = ctx.getImageData(0, 0, W, H).data;
        const g = new Uint8Array(W * H);
        for (let i = 0; i < g.length; i++) g[i] = (d[i * 4] * 299 + d[i * 4 + 1] * 587 + d[i * 4 + 2] * 114) / 1000;
        return g;
      };
      let bmp = await loadBitmap(u.blob);
      let gray = grayOf(bmp);

      // Выравниваем наклон фото прямо в подложке — так и обводить вручную удобнее.
      const skew = estimateSkew(gray, W, H, c);
      if (Math.abs(skew) > 0.15) {
        const cv = document.createElement('canvas');
        cv.width = u.w; cv.height = u.h;
        const ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, u.w, u.h);
        ctx.translate(u.w / 2, u.h / 2);
        ctx.rotate((skew * Math.PI) / 180);
        ctx.drawImage(bmp, -u.w / 2, -u.h / 2);
        bmp.close?.();
        u.blob = await canvasToBlob(cv, 'image/jpeg', 0.9);
        URL.revokeObjectURL(underlayUrl);
        underlayUrl = URL.createObjectURL(u.blob);
        bmp = cv;
        gray = grayOf(cv);
      }
      bmp.close?.();

      const found = detectRooms(gray, W, H, c, u.x, u.y);
      if (!found.length) {
        toast?.('Комнаты не нашлись — обведите их вручную');
        render();
        return;
      }
      // Тип угадываем по размеру и форме — риелтор проверит и поправит.
      const guessType = (pts) => {
        const b = bounds(pts), a = roomArea({ points: pts });
        const short = Math.min(b.maxX - b.minX, b.maxY - b.minY), long = Math.max(b.maxX - b.minX, b.maxY - b.minY);
        if (a < 2.8) return 'wc';
        if (a < 5) return 'bath';
        if (short <= 160 && long / short >= 2.5) return 'hall';
        return 'room';
      };
      change(() => {
        plan.rooms = found.map((r) => ({ id: uid(), type: guessType(r.points), name: '', points: r.points }));
        plan.openings = [];
        selectedId = null;
        selectedOpening = null; selectedFurn = null;
      });
      scheduleSave();
      userMovedView = false;
      fit();
      toast?.(`Найдено помещений: ${found.length}. Проверьте границы и типы комнат`);
    } catch (e) {
      toast?.('Не получилось распознать — обведите комнаты вручную');
    } finally {
      scanning = false;
    }
  }

  function calibrateTap(p) {
    calib = [...(calib || []), p];
    if (calib.length < 2) { render(); return; }
    render();
    const [a, b] = calib;
    const dist = edgeLength(a, b);
    // Даём браузеру дорисовать отрезок, прежде чем спросить длину.
    setTimeout(() => {
      const answer = prompt('Длина этой стены по плану, в метрах (например, 3,2):');
      const meters = parseFloat(String(answer || '').replace(',', '.'));
      calib = null;
      if (meters > 0 && dist > 1) {
        const u = project.underlay;
        const k = (meters * 100) / dist;
        u.scale *= k;
        u.x = a[0] - (a[0] - u.x) * k;
        u.y = a[1] - (a[1] - u.y) * k;
        u.calibrated = true;
        scheduleSave();
        userMovedView = false;
        setTool('select');
        fit();
        toast?.('Масштаб задан — обводите комнаты');
      } else {
        render();
      }
    }, 50);
  }
  function finishDraft() {
    if (draft && draft.length >= 3) {
      change(() => { plan.plot = draft.map((p) => [...p]); });
      toast?.('Границы участка заданы');
      setTool('select');
      return;
    }
    draft = null;
    render();
  }
  function setTool(t) {
    if (t !== tool) draft = null;
    tool = t;
    ghost = null;
    calib = null;
    if (t !== 'select') { selectedId = null; selectedOpening = null; selectedFurn = null; }
    renderAll();
  }

  // ---------- жесты ----------
  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    if (editorEl.classList.contains('sheet-open')) editorEl.classList.remove('sheet-open');
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // Второй палец — отменяем начатое действие и переходим в масштабирование.
      if (pending != null) { restore(pending); pending = null; }
      const info = pinchInfo();
      gesture = { type: 'pinch', ...info, world: toWorld(info.mx, info.my), s: view.s };
      render();
      return;
    }
    if (pointers.size > 2) return;

    const w = toWorld(e.clientX, e.clientY);
    const base = { sx: e.clientX, sy: e.clientY, moved: false };

    if (tool === 'select') {
      const v = e.target.closest('[data-vertex]');
      if (v && selectedId) {
        begin();
        gesture = { ...base, type: 'vertex', i: Number(v.dataset.vertex) };
        return;
      }
      const furnEdge = e.target.closest('[data-fedge]');
      const sel = furnEdge && findFurn(selectedFurn);
      if (sel) {
        begin();
        gesture = { ...base, type: 'furnEdge', side: furnEdge.dataset.fedge, start: w, orig: furnitureRect(sel.room, sel.item) };
        return;
      }
      const edgeEl = e.target.closest('[data-edge]');
      const opEl = e.target.closest('[data-opening]')
        || (edgeEl && document.elementsFromPoint(e.clientX, e.clientY).map((el) => el.closest('[data-opening]')).find(Boolean));
      if (opEl) {
        selectedOpening = opEl.dataset.opening;
        selectedId = null;
        selectedFurn = null;
        begin();
        gesture = { ...base, type: 'opening' };
        renderAll();
        return;
      }
      if (edgeEl && selectedId) {
        const room = plan.rooms.find((r) => r.id === selectedId);
        begin();
        gesture = { ...base, type: 'edge', i: Number(edgeEl.dataset.edge), start: w, orig: room.points.map((p) => [...p]) };
        return;
      }
      const furnEl = e.target.closest('[data-furn]');
      if (furnEl) {
        const room = plan.rooms.find((r) => r.id === furnEl.dataset.froom);
        const item = room?.furniture?.find((f) => f.id === furnEl.dataset.furn);
        if (item) {
          selectedId = null;
          selectedOpening = null;
          selectedFurn = item.id;
          // Если мебель привязана к стене, фиксируем её текущее положение центром.
          const r = furnitureRect(room, item);
          begin();
          gesture = {
            ...base, type: 'furniture', roomId: room.id, itemId: item.id,
            dx: (r.x + r.w / 2) - w[0], dy: (r.y + r.h / 2) - w[1],
          };
          renderAll();
          return;
        }
      }
      const roomEl = e.target.closest('[data-room]');
      if (roomEl) {
        selectedOpening = null; selectedFurn = null;
        selectedId = roomEl.dataset.room;
        const room = plan.rooms.find((r) => r.id === selectedId);
        begin();
        gesture = { ...base, type: 'move', start: w, orig: room.points.map((p) => [...p]), furn: (room.furniture || []).map((f) => [f, f.x, f.y]) };
        renderAll();
        return;
      }
      if (selectedId || selectedOpening || selectedFurn) { selectedId = null; selectedOpening = null; selectedFurn = null; renderAll(); }
      gesture = { ...base, type: 'pan', vx: view.x, vy: view.y };
    } else if (tool === 'rect') {
      const p = snapPt(w);
      gesture = { ...base, type: 'rect', start: p, end: p };
    } else if (tool === 'plot' || tool === 'door' || tool === 'window' || tool === 'calib') {
      gesture = { ...base, type: 'tap', vx: view.x, vy: view.y };
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = toWorld(e.clientX, e.clientY);
    const placing = tool === 'door' || tool === 'window';
    if (e.pointerType === 'mouse' || gesture) hover = tool === 'select' || tool === 'calib' || placing ? null : snapPt(w, null, draft || []);
    if (placing && e.pointerType === 'mouse' && !gesture) {
      const at = edgeAt(w);
      ghost = at && { type: tool, ...at, width: OPENING_TYPES[tool].width, swing: 'in', hinge: 'a' };
    }

    if (!gesture) { if (tool !== 'select' && e.pointerType === 'mouse') render(); return; }

    if (gesture.type === 'pinch') {
      if (pointers.size < 2) return;
      userMovedView = true;
      const info = pinchInfo();
      const s = Math.min(MAX_S, Math.max(MIN_S, gesture.s * info.d / gesture.d));
      const r = svg.getBoundingClientRect();
      view.s = s;
      view.x = gesture.world[0] - (info.mx - r.left) / s;
      view.y = gesture.world[1] - (info.my - r.top) / s;
      render();
      return;
    }

    if (!gesture.moved && Math.hypot(e.clientX - gesture.sx, e.clientY - gesture.sy) > TAP_PX) gesture.moved = true;

    switch (gesture.type) {
      case 'pan':
      case 'tap':
        if (!gesture.moved) return;
        userMovedView = true;
        view.x = gesture.vx - (e.clientX - gesture.sx) / view.s;
        view.y = gesture.vy - (e.clientY - gesture.sy) / view.s;
        break;
      case 'move': {
        if (!gesture.moved) return;
        const room = plan.rooms.find((r) => r.id === selectedId);
        const [dx, dy] = snapMove(gesture.orig, w[0] - gesture.start[0], w[1] - gesture.start[1], selectedId);
        room.points = gesture.orig.map(([x, y]) => [x + dx, y + dy]);
        for (const [f, x, y] of gesture.furn) if (x != null && y != null) { f.x = x + dx; f.y = y + dy; }
        break;
      }
      case 'furnEdge': {
        if (!gesture.moved) return;
        const found = findFurn(selectedFurn);
        if (found) resizeFurniture(found, gesture, w);
        break;
      }
      case 'furniture': {
        if (!gesture.moved) return;
        const room = plan.rooms.find((r) => r.id === gesture.roomId);
        const item = room?.furniture?.find((f) => f.id === gesture.itemId);
        if (item) {
          item.x = Math.round(w[0] + gesture.dx);
          item.y = Math.round(w[1] + gesture.dy);
        }
        break;
      }
      case 'vertex': {
        const room = plan.rooms.find((r) => r.id === selectedId);
        room.points[gesture.i] = snapPt(w, room.id, room.points.filter((_, i) => i !== gesture.i));
        break;
      }
      case 'edge': {
        if (!gesture.moved) return;
        const room = plan.rooms.find((r) => r.id === selectedId);
        room.points = movedEdge(gesture.orig, gesture.i, w[0] - gesture.start[0], w[1] - gesture.start[1], room.id);
        break;
      }
      case 'rect':
        gesture.end = snapPt(w);
        break;
      case 'opening': {
        if (!gesture.moved) return;
        const op = plan.openings.find((o) => o.id === selectedOpening);
        const at = edgeAt(w);
        if (op && at) Object.assign(op, at);
        break;
      }
    }
    render();
  });

  function endPointer(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (!gesture) return;
    if (gesture.type === 'pinch') {
      if (pointers.size === 0) gesture = null;
      return;
    }
    const g = gesture;
    gesture = null;
    guides = [];
    if (e.type === 'pointercancel') {
      if (pending != null) { restore(pending); pending = null; }
      renderAll();
      return;
    }

    if (g.type === 'move' || g.type === 'vertex' || g.type === 'edge' || g.type === 'opening' || g.type === 'furniture' || g.type === 'furnEdge') {
      commit();
    } else if (g.type === 'tap' && !g.moved && tool === 'calib') {
      calibrateTap(toWorld(e.clientX, e.clientY));
    } else if (g.type === 'tap' && !g.moved && (tool === 'door' || tool === 'window')) {
      const at = edgeAt(toWorld(e.clientX, e.clientY));
      if (at) addOpening(tool, at);
      else toast?.('Нажмите ближе к стене комнаты');
      ghost = null;
      render();
    } else if (g.type === 'rect') {
      const [x1, y1] = g.start, [x2, y2] = g.end;
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      if (w >= MIN_ROOM && h >= MIN_ROOM) addRoom(rectPoints(Math.min(x1, x2), Math.min(y1, y2), w, h));
      else render();
    } else if (g.type === 'tap' && !g.moved) {
      const p = snapPt(toWorld(e.clientX, e.clientY), null, draft || []);
      guides = [];
      if (!draft) draft = [];
      const first = draft[0];
      if (draft.length >= 3 && Math.hypot((first[0] - p[0]) * view.s, (first[1] - p[1]) * view.s) <= CLOSE_PX) {
        finishDraft();
        return;
      }
      const last = draft[draft.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) draft.push(p);
      render();
    } else {
      render();
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'mouse' && !gesture) { hover = null; ghost = null; render(); }
  });

  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > 40 && !e.deltaX) {
      zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)));
    } else {
      userMovedView = true;
      view.x += e.deltaX / view.s;
      view.y += e.deltaY / view.s;
      render();
    }
  }, { passive: false });

  function onKey(e) {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (typing) {
      if (e.key === 'Enter') document.activeElement.blur();
    } else if (e.key === 'Escape') {
      if (tool === 'calib') { setTool('select'); } else if (draft) { draft = null; render(); } else { selectedId = null; selectedOpening = null; selectedFurn = null; renderAll(); }
    } else if (e.key === 'Enter' && draft) {
      finishDraft();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && (selectedId || selectedOpening || selectedFurn)) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'v') setTool('select');
    else if (e.key === 'r') setTool('rect');
    else if (e.key === 'd') setTool('door');
    else if (e.key === 'w') setTool('window');
  }
  document.addEventListener('keydown', onKey);

  // ---------- кнопки ----------
  root.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('#finish').onclick = finishDraft;
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#fit').onclick = () => { userMovedView = false; fit(); };
  $('#sheet').onclick = () => { editorEl.classList.toggle('sheet-open'); render(); };
  $('#sel-chip').onclick = () => { editorEl.classList.add('sheet-open'); render(); };
  bindTopbar(root, project, scheduleSave);

  // Пока пользователь сам не двигал вид, держим весь план в кадре (в т.ч. при повороте экрана).
  const ro = new ResizeObserver(() => (userMovedView ? render() : fit()));
  ro.observe(svg);

  renderPanel();

  return async function close() {
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    if (saveTimer) await flush();
    if (underlayUrl) URL.revokeObjectURL(underlayUrl);
  };
}
