// Автоматическое распознавание комнат на фото плана БТИ — без библиотек.
// Идея: тёмные линии плана = стены; дверные проёмы «закрываем» морфологическим замыканием;
// замкнутые светлые области внутри квартиры = комнаты; контур снимаем по сетке 10 см,
// поэтому он сразу прямоугольный и ровно ложится на сетку редактора.
// Чистые функции над массивом яркостей — их можно гонять и в браузере, и в Node.

const DOOR_R = 46;          // см: закрываем проёмы до ~90 см (двери)
const NARROW_R = 30;        // см: второй проход для узких помещений (туалет, коридор)
const TEXT_MAX = 60;        // см: тёмные пятна меньше этого — надписи и цифры, не стены
const MIN_ROOM_M2 = 0.8;    // меньше — не помещение
const MIN_THICK = 25;       // см: в помещение должен влезать квадрат 50×50 см
const CELL = 5;             // см: шаг сетки контура

// ---------- морфология на интегральных изображениях ----------
function integral(src, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row;
    }
  }
  return I;
}

function windowed(mask, w, h, r, test) {
  const I = integral(mask, w, h);
  const out = new Uint8Array(w * h);
  const W = w + 1;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const s = I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0];
      out[y * w + x] = test(s, (x1 - x0) * (y1 - y0)) ? 1 : 0;
    }
  }
  return out;
}
const dilate = (m, w, h, r) => windowed(m, w, h, r, (s) => s > 0);
const erode = (m, w, h, r) => windowed(m, w, h, r, (s, n) => s === n);
const closeMask = (m, w, h, r) => erode(dilate(m, w, h, r), w, h, r);

// ---------- бинаризация: локальный порог + общий (Оцу) ----------
function otsu(gray) {
  const hist = new Float64Array(256);
  for (const g of gray) hist[g]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, t = 127;
  for (let i = 0; i < 256; i++) {
    wB += hist[i];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += i * hist[i];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) ** 2;
    if (v > best) { best = v; t = i; }
  }
  return t;
}

function binarize(gray, w, h, c) {
  const t = otsu(gray);
  const r = Math.max(4, Math.round(40 / c));      // окно ~80 см: выравнивает неровный свет на фото
  const I = integral(gray, w, h);
  const W = w + 1;
  const dark = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const mean = (I[y1 * W + x1] - I[y0 * W + x1] - I[y1 * W + x0] + I[y0 * W + x0]) / ((x1 - x0) * (y1 - y0));
      const g = gray[y * w + x];
      dark[y * w + x] = g < mean - 12 && g < t + 25 ? 1 : 0;
    }
  }
  return dark;
}

// ---------- связные области ----------
function label(mask, w, h, eight = false) {
  const lab = new Int32Array(w * h);
  const comps = [null];
  const stack = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (!mask[start] || lab[start]) continue;
    const id = comps.length;
    const comp = { n: 0, minX: w, minY: h, maxX: 0, maxY: 0, border: false };
    let sp = 0;
    stack[sp++] = start;
    lab[start] = id;
    while (sp) {
      const i = stack[--sp];
      const x = i % w, y = (i - x) / w;
      comp.n++;
      if (x < comp.minX) comp.minX = x; if (x > comp.maxX) comp.maxX = x;
      if (y < comp.minY) comp.minY = y; if (y > comp.maxY) comp.maxY = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) comp.border = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (!eight && dx && dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (mask[j] && !lab[j]) { lab[j] = id; stack[sp++] = j; }
      }
    }
    comps.push(comp);
  }
  return { lab, comps };
}

// ---------- контур по сетке ----------
// cells: Uint8Array cw×ch. Возвращает внешний контур (по рёбрам клеток) в координатах клеток.
function traceOuter(cells, cw, ch) {
  const on = (i, j) => i >= 0 && j >= 0 && i < cw && j < ch && cells[j * cw + i];
  const edges = new Map();       // "x,y" → [[x2,y2], ...]
  const add = (a, b) => { const k = `${a[0]},${a[1]}`; (edges.get(k) || edges.set(k, []).get(k)).push(b); };
  let count = 0;
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    if (!on(i, j)) continue;
    if (!on(i, j - 1)) { add([i, j], [i + 1, j]); count++; }
    if (!on(i + 1, j)) { add([i + 1, j], [i + 1, j + 1]); count++; }
    if (!on(i, j + 1)) { add([i + 1, j + 1], [i, j + 1]); count++; }
    if (!on(i - 1, j)) { add([i, j + 1], [i, j]); count++; }
  }
  const loops = [];
  while (count > 0) {
    const [startKey, list] = [...edges.entries()].find(([, l]) => l.length);
    let cur = startKey.split(',').map(Number);
    let next = list.pop(); count--;
    const loop = [cur];
    let dir = [next[0] - cur[0], next[1] - cur[1]];
    cur = next;
    while (`${cur[0]},${cur[1]}` !== startKey) {
      loop.push(cur);
      const outs = edges.get(`${cur[0]},${cur[1]}`);
      if (!outs?.length) break;
      // В «щипке» (клетки касаются углом) поворачиваем вправо — так контуры не слипаются.
      let pick = 0;
      if (outs.length > 1) {
        const score = (o) => { const d = [o[0] - cur[0], o[1] - cur[1]]; return dir[0] * d[1] - dir[1] * d[0]; };
        pick = outs.reduce((bi, o, i) => (score(o) > score(outs[bi]) ? i : bi), 0);
      }
      next = outs.splice(pick, 1)[0]; count--;
      dir = [next[0] - cur[0], next[1] - cur[1]];
      cur = next;
    }
    loops.push(loop);
  }
  const area = (l) => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2;
  return loops.sort((a, b) => area(b) - area(a))[0] || [];
}

function dropCollinear(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
    if ((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]) !== 0) out.push(b);
  }
  return out;
}

// Убираем «ступеньки» в 1 клетку — следы слегка повёрнутого фото.
// Ступенька a→b→c→d: b→c длиной в 1 клетку, a→b и c→d в одну сторону.
// Убираем b и c, а d переносим на линию a–b.
function removeSteps(pts) {
  let changed = true;
  while (changed && pts.length > 4) {
    changed = false;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const ia = i, ib = (i + 1) % n, ic = (i + 2) % n, id = (i + 3) % n;
      const [a, b, c, d] = [pts[ia], pts[ib], pts[ic], pts[id]];
      const len = Math.abs(b[0] - c[0]) + Math.abs(b[1] - c[1]);
      const ab = [Math.sign(b[0] - a[0]), Math.sign(b[1] - a[1])];
      const cd = [Math.sign(d[0] - c[0]), Math.sign(d[1] - c[1])];
      if (len > 1 || ab[0] !== cd[0] || ab[1] !== cd[1]) continue;
      pts[id] = ab[0] ? [d[0], a[1]] : [a[0], d[1]];
      pts = pts.filter((_, k) => k !== ib && k !== ic);
      pts = dropCollinear(pts);
      changed = true;
      break;
    }
  }
  return pts;
}

// Толстые линии (стены): то, что переживает «открытие» окном ~5 см.
function thickLines(dark, w, h, c) {
  const r = Math.max(1, Math.round(2.5 / c));
  return dilate(erode(dark, w, h, r), w, h, r);
}

/**
 * Наклон плана на фото, в градусах (−5…5). Ищем угол, при котором стены дают
 * самые «острые» проекции по строкам и столбцам.
 */
export function estimateSkew(gray, w, h, c) {
  const thick = thickLines(binarize(gray, w, h, c), w, h, c);
  const pts = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 60000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) if (thick[y * w + x]) pts.push(x - w / 2, y - h / 2);
  if (pts.length < 200) return 0;
  const score = (deg) => {
    const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a);
    // Корзины шириной в шаг выборки — иначе при 0° сетка точек сама даёт «острые» пики.
    const off = Math.ceil(Math.hypot(w, h) / step);
    const rows = new Float64Array(off * 2 + 1), cols = new Float64Array(off * 2 + 1);
    for (let i = 0; i < pts.length; i += 2) {
      const x = pts[i], y = pts[i + 1];
      rows[Math.round((x * sn + y * cs) / step) + off]++;
      cols[Math.round((x * cs - y * sn) / step) + off]++;
    }
    let s = 0;
    for (let i = 0; i < rows.length; i++) s += rows[i] * rows[i] + cols[i] * cols[i];
    return s;
  };
  let best = 0, bestS = -1;
  for (let d = -5; d <= 5.001; d += 0.25) { const v = score(d); if (v > bestS) { bestS = v; best = d; } }
  const coarse = best;
  for (let d = coarse - 0.25; d <= coarse + 0.25; d += 0.05) { const v = score(d); if (v > bestS) { bestS = v; best = d; } }
  return Math.round(best * 100) / 100;
}

/**
 * gray — Uint8Array яркостей w×h; c — сантиметров на пиксель;
 * ox, oy — мировые координаты (см) левого верхнего пикселя.
 * Возвращает [{ points: [[x, y], ...] }] — внутренние контуры помещений в мировых см на сетке 10 см.
 */
export function detectRooms(gray, w, h, c, ox = 0, oy = 0) {
  // 1. Тёмное = линии плана; мелкие пятна (буквы, цифры) выкидываем.
  const dark = binarize(gray, w, h, c);
  {
    const { lab, comps } = label(dark, w, h, true);
    const keep = comps.map((k) => k && Math.max(k.maxX - k.minX, k.maxY - k.minY) * c >= TEXT_MAX);
    for (let i = 0; i < dark.length; i++) if (dark[i] && !keep[lab[i]]) dark[i] = 0;
  }
  // Тонкие линии, которые не касаются стен (ванна, мебель, размерные линии), — не стены.
  // Тонкие линии у стен (окна, дуги дверей) оставляем: они «запирают» проёмы.
  const thick = thickLines(dark, w, h, c);
  {
    const near = dilate(thick, w, h, Math.max(1, Math.round(3 / c)));
    const thin = dark.map((v, i) => (v && !thick[i] ? 1 : 0));
    const { lab, comps } = label(thin, w, h, true);
    const touches = new Uint8Array(comps.length);
    for (let i = 0; i < thin.length; i++) if (lab[i] && near[i]) touches[lab[i]] = 1;
    for (let i = 0; i < dark.length; i++) if (thin[i] && !touches[lab[i]]) dark[i] = 0;
  }
  const nearThick = dilate(thick, w, h, Math.max(1, Math.round(8 / c)));
  // Помещение — это область, большая часть границы которой — настоящие стены.
  const wallBound = (lab, id) => {
    let edge = 0, wall = 0;
    for (let i = 0; i < lab.length; i++) {
      if (lab[i] !== id) continue;
      const x = i % w;
      if ((x > 0 && lab[i - 1] !== id) || (x < w - 1 && lab[i + 1] !== id) || lab[i - w] !== id || lab[i + w] !== id) {
        edge++;
        if (nearThick[i]) wall++;
      }
    }
    return edge && wall / edge >= 0.5;
  };

  const minPx = (MIN_ROOM_M2 * 10000) / (c * c);
  const thickR = Math.max(1, Math.round(MIN_THICK / c));

  // 2. Первый проход: закрываем проёмы до ~90 см — получаем основные комнаты.
  const free1 = closeMask(dark, w, h, Math.round(DOOR_R / c)).map((v) => 1 - v);
  const L1 = label(free1, w, h);
  const thick1 = erode(free1, w, h, thickR);
  const room = new Int32Array(w * h);      // итоговая метка помещения
  let rooms = 0;
  const hasThick = (lab, id, thick) => { for (let i = 0; i < lab.length; i++) if (lab[i] === id && thick[i]) return true; return false; };
  const ok1 = L1.comps.map((k, id) => k && !k.border && k.n >= minPx && hasThick(L1.lab, id, thick1) && wallBound(L1.lab, id));
  const map1 = new Int32Array(L1.comps.length);
  ok1.forEach((v, id) => { if (v) map1[id] = ++rooms; });
  for (let i = 0; i < room.length; i++) if (map1[L1.lab[i]]) room[i] = map1[L1.lab[i]];

  // 3. Второй проход: узкие помещения, которые первый проход «залил» (туалет, узкий коридор).
  const free2 = closeMask(dark, w, h, Math.round(NARROW_R / c)).map((v) => 1 - v);
  const L2 = label(free2, w, h);
  const rest = new Uint8Array(w * h);
  for (let i = 0; i < rest.length; i++) rest[i] = free2[i] && !L2.comps[L2.lab[i]]?.border && !room[i] ? 1 : 0;
  // Срезаем тонкие «каёмки» вокруг уже найденных комнат.
  const restOpen = dilate(erode(rest, w, h, thickR), w, h, thickR);
  for (let i = 0; i < rest.length; i++) rest[i] = rest[i] && restOpen[i] ? 1 : 0;
  const L3 = label(rest, w, h);
  const thick3 = erode(rest, w, h, thickR);
  L3.comps.forEach((k, id) => {
    if (!k || k.border || k.n < minPx || !hasThick(L3.lab, id, thick3) || !wallBound(L3.lab, id)) return;
    const r = ++rooms;
    for (let i = 0; i < room.length; i++) if (L3.lab[i] === id) room[i] = r;
  });

  // 4. Контуры по сетке 10 см в мировых координатах.
  const i0 = Math.floor(ox / CELL), j0 = Math.floor(oy / CELL);
  const cw = Math.ceil((ox + w * c) / CELL) - i0, ch = Math.ceil((oy + h * c) / CELL) - j0;
  const cellRoom = new Int32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const px = Math.floor(((i0 + i + 0.5) * CELL - ox) / c), py = Math.floor(((j0 + j + 0.5) * CELL - oy) / c);
    if (px >= 0 && py >= 0 && px < w && py < h) cellRoom[j * cw + i] = room[py * w + px];
  }

  const result = [];
  for (let r = 1; r <= rooms; r++) {
    const cells = new Uint8Array(cw * ch);
    let n = 0, minI = cw, minJ = ch, maxI = 0, maxJ = 0;
    for (let k = 0; k < cells.length; k++) {
      if (cellRoom[k] !== r) continue;
      cells[k] = 1; n++;
      const i = k % cw, j = (k - i) / cw;
      minI = Math.min(minI, i); maxI = Math.max(maxI, i); minJ = Math.min(minJ, j); maxJ = Math.max(maxJ, j);
    }
    if (!n) continue;
    // Оставляем самый крупный кусок (на случай, если область распалась при переводе в клетки).
    const { lab, comps } = label(cells, cw, ch);
    const big = comps.reduce((bi, k, id) => (k && (!comps[bi] || k.n > comps[bi].n) ? id : bi), 0);
    for (let k = 0; k < cells.length; k++) cells[k] = lab[k] === big ? 1 : 0;
    const b = comps[big];
    const bboxN = (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
    let pts;
    if (b.n / bboxN >= 0.85) {
      // Почти прямоугольник: края берём там, где заполнено больше половины строки/столбца,
      // чтобы «ступеньки» от неровного края не раздували комнату.
      const rows = new Int32Array(ch), cols = new Int32Array(cw);
      for (let k = 0; k < cells.length; k++) if (cells[k]) { rows[(k - (k % cw)) / cw]++; cols[k % cw]++; }
      const maxR = Math.max(...rows), maxC = Math.max(...cols);
      let y0 = b.minY, y1 = b.maxY, x0 = b.minX, x1 = b.maxX;
      while (y0 < y1 && rows[y0] < maxR / 2) y0++;
      while (y1 > y0 && rows[y1] < maxR / 2) y1--;
      while (x0 < x1 && cols[x0] < maxC / 2) x0++;
      while (x1 > x0 && cols[x1] < maxC / 2) x1--;
      pts = [[x0, y0], [x1 + 1, y0], [x1 + 1, y1 + 1], [x0, y1 + 1]];
    } else {
      pts = removeSteps(dropCollinear(traceOuter(cells, cw, ch)));
    }
    if (pts.length < 4) continue;
    result.push({ points: pts.map(([i, j]) => [(i0 + i) * CELL, (j0 + j) * CELL]) });
  }
  return result;
}
