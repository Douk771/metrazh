// Редактор планировки на SVG. Мировые координаты — сантиметры.
// Комната = внутренний контур; стена рисуется снаружи контура толщиной plan.wallCm.
import {
  ROOM_TYPES, snap, centroid, bounds, asAxisRect, rectPoints,
  edgeLength, fmtArea, fmtLen, summarize, roomArea,
} from './geometry.js';
import { uid } from './db.js';
import { topbar, bindTopbar } from './ui.js';

const STEP = 10;              // шаг привязки, см
const MIN_ROOM = 30;          // меньше — считаем случайным касанием, см
const TAP_PX = 8;             // сдвиг пальца, который ещё считается тапом
const CLOSE_PX = 22;          // радиус «попадания» в первую точку контура
const MIN_S = 0.03, MAX_S = 6; // масштаб, пикселей на сантиметр

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pts = (points) => points.map((p) => p.join(',')).join(' ');
const typeOf = (room) => ROOM_TYPES[room.type] || ROOM_TYPES.room;
const roomName = (room) => room.name || typeOf(room).short;

function wallsAndFills(plan, attrs = () => '') {
  const walls = plan.rooms.map((r) =>
    `<polygon points="${pts(r.points)}" fill="none" stroke="#2b2f2d" stroke-width="${plan.wallCm * 2}" stroke-linejoin="miter"/>`).join('');
  const fills = plan.rooms.map((r) =>
    `<polygon points="${pts(r.points)}" fill="${typeOf(r).fill}" ${attrs(r)}/>`).join('');
  return walls + fills;
}

export function planThumbnail(plan) {
  if (!plan.rooms.length) return '<svg class="thumb" viewBox="0 0 4 3" aria-hidden="true"></svg>';
  const b = bounds(plan.rooms.flatMap((r) => r.points));
  const pad = plan.wallCm + 60;
  const vb = [b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2].join(' ');
  return `<svg class="thumb" viewBox="${vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${wallsAndFills(plan)}</svg>`;
}

export function openEditor(root, project, { onSave, toast }) {
  const plan = project.plan;
  let tool = 'select';
  let selectedId = null;
  let view = { x: 0, y: 0, s: 1 };
  let draft = null;        // точки строящегося контура
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
        <div class="hint" id="hint"></div>
        <div class="tools" role="toolbar">
          <button class="btn" data-tool="select" title="Выбрать и двигать">Выбор</button>
          <button class="btn" data-tool="rect" title="Прямоугольная комната">Комната</button>
          <button class="btn" data-tool="poly" title="Комната произвольной формы">Контур</button>
          <button class="btn primary" id="finish" hidden>Готово</button>
          <span class="sep"></span>
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

  // ---------- сохранение и история ----------
  const snapshot = () => JSON.stringify({ rooms: plan.rooms, wallCm: plan.wallCm });
  function restore(json) {
    const s = JSON.parse(json);
    plan.rooms = s.rooms;
    plan.wallCm = s.wallCm;
    if (!plan.rooms.some((r) => r.id === selectedId)) selectedId = null;
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
  const snapPt = (p) => [snap(p[0], STEP), snap(p[1], STEP)];

  function fit() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const all = plan.rooms.flatMap((x) => x.points);
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

    html += wallsAndFills(plan, (room) => `data-room="${room.id}" style="cursor:${tool === 'select' ? 'move' : 'crosshair'}"`);

    // подписи комнат
    const fs = px(13);
    for (const room of plan.rooms) {
      const [cx, cy] = centroid(room.points);
      html += `<text x="${cx}" y="${cy}" text-anchor="middle" font-size="${fs}" fill="#1d2321"
        stroke="#fffdf8" stroke-width="${px(3)}" paint-order="stroke" pointer-events="none">
        <tspan x="${cx}" dy="${-fs * 0.2}">${esc(roomName(room))}</tspan>
        <tspan x="${cx}" dy="${fs * 1.25}" font-weight="600">${fmtArea(roomArea(room))} м²</tspan></text>`;
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

    world.setAttribute('transform', `matrix(${s} 0 0 ${s} ${-view.x * s} ${-view.y * s})`);
    world.innerHTML = html;

    $('#undo').disabled = !history.length;
    $('#redo').disabled = !future.length;
    $('#finish').hidden = !(draft && draft.length >= 3);
    root.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    hint.textContent = hintText();
  }

  function hintText() {
    if (tool === 'rect') return 'Проведите пальцем по диагонали комнаты';
    if (tool === 'poly') {
      if (!draft) return 'Нажимайте по очереди на углы комнаты';
      return draft.length >= 3 ? 'Нажмите на первую точку или «Готово», чтобы замкнуть' : 'Следующий угол…';
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

    panel.innerHTML = `
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

      <h2>Объект</h2>
      <label class="field">Адрес<input id="p-addr" value="${esc(project.address)}" placeholder="Город, улица, дом"></label>
      <label class="field">Толщина стен на чертеже, см<input id="p-wall" type="number" inputmode="numeric" min="4" max="60" step="1" value="${plan.wallCm}"></label>
      <p class="muted">Площадь считается по внутреннему контуру комнаты, как в техпаспорте. Стены рисуются снаружи и в площадь не входят.</p>`;

    panel.querySelectorAll('[data-pick]').forEach((b) => {
      b.onclick = () => { selectedId = b.dataset.pick; tool = 'select'; renderAll(); };
    });
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
    $('#p-addr').onchange = (e) => { project.address = e.target.value.trim(); scheduleSave(); };
    $('#p-wall').onchange = (e) => {
      const v = Math.round(Number(e.target.value));
      if (v >= 4 && v <= 60) change(() => { plan.wallCm = v; });
      else renderPanel();
    };
  }

  function renderAll() { render(); renderPanel(); }

  // ---------- действия ----------
  function addRoom(points) {
    const room = { id: uid(), type: 'room', name: '', points };
    change(() => { plan.rooms.push(room); selectedId = room.id; });
    toast?.(`Комната ${fmtArea(roomArea(room))} м²`);
  }
  function deleteSelected() {
    if (!selectedId) return;
    change(() => { plan.rooms = plan.rooms.filter((r) => r.id !== selectedId); selectedId = null; });
  }
  function finishDraft() {
    if (draft && draft.length >= 3) addRoom(draft);
    draft = null;
    render();
  }
  function setTool(t) {
    if (t !== 'poly') draft = null;
    tool = t;
    if (t !== 'select') selectedId = null;
    renderAll();
  }

  // ---------- жесты ----------
  function pinchInfo() {
    const [a, b] = [...pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
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
      const roomEl = e.target.closest('[data-room]');
      if (roomEl) {
        selectedId = roomEl.dataset.room;
        const room = plan.rooms.find((r) => r.id === selectedId);
        begin();
        gesture = { ...base, type: 'move', start: w, orig: room.points.map((p) => [...p]) };
        renderAll();
        return;
      }
      if (selectedId) { selectedId = null; renderAll(); }
      gesture = { ...base, type: 'pan', vx: view.x, vy: view.y };
    } else if (tool === 'rect') {
      const p = snapPt(w);
      gesture = { ...base, type: 'rect', start: p, end: p };
    } else if (tool === 'poly') {
      gesture = { ...base, type: 'tap', vx: view.x, vy: view.y };
    }
  });

  svg.addEventListener('pointermove', (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const w = toWorld(e.clientX, e.clientY);
    if (e.pointerType === 'mouse' || gesture) hover = tool === 'select' ? null : snapPt(w);

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
        const dx = snap(w[0] - gesture.start[0], STEP), dy = snap(w[1] - gesture.start[1], STEP);
        room.points = gesture.orig.map(([x, y]) => [x + dx, y + dy]);
        break;
      }
      case 'vertex': {
        const room = plan.rooms.find((r) => r.id === selectedId);
        room.points[gesture.i] = snapPt(w);
        break;
      }
      case 'rect':
        gesture.end = snapPt(w);
        break;
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
    if (e.type === 'pointercancel') {
      if (pending != null) { restore(pending); pending = null; }
      renderAll();
      return;
    }

    if (g.type === 'move' || g.type === 'vertex') {
      commit();
    } else if (g.type === 'rect') {
      const [x1, y1] = g.start, [x2, y2] = g.end;
      const w = Math.abs(x2 - x1), h = Math.abs(y2 - y1);
      if (w >= MIN_ROOM && h >= MIN_ROOM) addRoom(rectPoints(Math.min(x1, x2), Math.min(y1, y2), w, h));
      else render();
    } else if (g.type === 'tap' && !g.moved) {
      const p = snapPt(toWorld(e.clientX, e.clientY));
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
    if (e.pointerType === 'mouse' && !gesture) { hover = null; render(); }
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
      if (draft) { draft = null; render(); } else { selectedId = null; renderAll(); }
    } else if (e.key === 'Enter' && draft) {
      finishDraft();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      e.preventDefault();
      deleteSelected();
    } else if (e.key === 'v') setTool('select');
    else if (e.key === 'r') setTool('rect');
    else if (e.key === 'p') setTool('poly');
  }
  document.addEventListener('keydown', onKey);

  // ---------- кнопки ----------
  root.querySelectorAll('[data-tool]').forEach((b) => { b.onclick = () => setTool(b.dataset.tool); });
  $('#finish').onclick = finishDraft;
  $('#undo').onclick = undo;
  $('#redo').onclick = redo;
  $('#fit').onclick = () => { userMovedView = false; fit(); };
  $('#sheet').onclick = () => editorEl.classList.toggle('sheet-open');
  bindTopbar(root, project, scheduleSave);

  // Пока пользователь сам не двигал вид, держим весь план в кадре (в т.ч. при повороте экрана).
  const ro = new ResizeObserver(() => (userMovedView ? render() : fit()));
  ro.observe(svg);

  renderPanel();

  return async function close() {
    document.removeEventListener('keydown', onKey);
    ro.disconnect();
    if (saveTimer) await flush();
  };
}
