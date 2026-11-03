// Геометрия планировки. Все координаты — в сантиметрах.
// Контур комнаты — её внутренний контур (как в БТИ), стены рисуются снаружи.

// Палитра из брендбука: пастельные заливки по назначению помещения.
export const ROOM_TYPES = {
  living:  { label: 'Жилая комната',      short: 'Жилая',     fill: '#f7e0c8', tone: '#e0a878', living: true },
  room:    { label: 'Комната',            short: 'Комната',   fill: '#f7e0c8', tone: '#e0a878', living: true },
  bedroom: { label: 'Спальня',            short: 'Спальня',   fill: '#f2dcda', tone: '#d99a96', living: true },
  kitchen: { label: 'Кухня',              short: 'Кухня',     fill: '#f7ecc8', tone: '#d9c07a', kitchen: true },
  bath:    { label: 'Ванная',             short: 'Ванная',    fill: '#d3e6ee', tone: '#7fb0c4' },
  wc:      { label: 'Туалет',             short: 'Туалет',    fill: '#d3e6ee', tone: '#7fb0c4' },
  combo:   { label: 'Совмещённый санузел', short: 'С/у',      fill: '#d3e6ee', tone: '#7fb0c4' },
  hall:    { label: 'Прихожая / коридор', short: 'Коридор',   fill: '#e9e6dc', tone: '#b4b0a2' },
  storage: { label: 'Кладовая / гардероб', short: 'Кладовая', fill: '#e4e0ee', tone: '#a99fc4' },
  balcony: { label: 'Балкон',             short: 'Балкон',    fill: '#dcebda', tone: '#8fb98a', outdoor: true },
  loggia:  { label: 'Лоджия',             short: 'Лоджия',    fill: '#dcebda', tone: '#8fb98a', outdoor: true },
};

// Мебель-примитивы: размеры в см (ширина × глубина).
export const FURNITURE = {
  sofa:     { label: 'Диван',        w: 200, h: 90,  kind: 'box' },
  armchair: { label: 'Кресло',       w: 90,  h: 85,  kind: 'box' },
  bed:      { label: 'Кровать',      w: 160, h: 200, kind: 'bed' },
  bedSingle:{ label: 'Кровать 1-сп.', w: 90, h: 200, kind: 'bed' },
  wardrobe: { label: 'Шкаф',         w: 180, h: 60,  kind: 'box' },
  table:    { label: 'Стол',         w: 120, h: 80,  kind: 'round' },
  chairs:   { label: 'Стул',         w: 45,  h: 45,  kind: 'box' },
  kitchen:  { label: 'Кухня',        w: 200, h: 60,  kind: 'kitchen' },
  stove:    { label: 'Плита',        w: 60,  h: 60,  kind: 'stove' },
  sink:     { label: 'Мойка',        w: 60,  h: 60,  kind: 'sink' },
  fridge:   { label: 'Холодильник',  w: 70,  h: 70,  kind: 'box' },
  toilet:   { label: 'Унитаз',       w: 50,  h: 60,  kind: 'toilet' },
  bathTub:  { label: 'Ванна',        w: 180, h: 80,  kind: 'tub' },
  shower:   { label: 'Душ',          w: 90,  h: 90,  kind: 'shower' },
  washbasin:{ label: 'Раковина',     w: 60,  h: 45,  kind: 'sink' },
};

// Готовые комнаты: размер + набор мебели с подсказкой, куда её ставить.
// anchor: 'left' | 'right' | 'center' | 'corner' — примыкание к стене.
export const ROOM_PRESETS = {
  living: {
    label: 'Жилая комната', type: 'living', w: 600, h: 300,
    furniture: [{ type: 'sofa', anchor: 'left', gap: 5, rot: 270 }],
  },
  bedroom: {
    label: 'Спальня', type: 'bedroom', w: 600, h: 300,
    furniture: [{ type: 'bed', anchor: 'left', gap: 5, rot: 270 }],
  },
  kitchen: {
    label: 'Кухня', type: 'kitchen', w: 400, h: 300,
    furniture: [{ type: 'kitchen', anchor: 'corner' }],
  },
  combo: {
    label: 'Совмещённый санузел', type: 'combo', w: 200, h: 200,
    furniture: [{ type: 'toilet', anchor: 'right', gap: 5, rot: 90 }],
  },
  bath: {
    label: 'Ванная', type: 'bath', w: 200, h: 200,
    furniture: [{ type: 'bathTub', anchor: 'top', gap: 5 }],
  },
  wc: {
    label: 'Туалет', type: 'wc', w: 120, h: 140,
    furniture: [{ type: 'toilet', anchor: 'left', gap: 5, rot: 270 }],
  },
  hall: {
    label: 'Коридор', type: 'hall', w: 200, h: 400,
    furniture: [],
  },
  storage: {
    label: 'Кладовая', type: 'storage', w: 200, h: 150,
    furniture: [],
  },
  balcony: {
    label: 'Балкон', type: 'balcony', w: 300, h: 100,
    furniture: [],
  },
};

export function snap(v, step) {
  return Math.round(v / step) * step;
}

// Площадь по формуле шнурования, в м².
export function areaM2(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return Math.abs(s) / 2 / 10000;
}

export function centroid(points) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    const f = x1 * y2 - x2 * y1;
    a += f; cx += (x1 + x2) * f; cy += (y1 + y2) * f;
  }
  if (Math.abs(a) < 1e-9) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bounds(points) {
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

// Прямоугольник, выровненный по осям? Тогда можно редактировать ширину/длину числами.
export function asAxisRect(points) {
  if (points.length !== 4) return null;
  const b = bounds(points);
  const corners = new Set([`${b.minX},${b.minY}`, `${b.maxX},${b.minY}`, `${b.maxX},${b.maxY}`, `${b.minX},${b.maxY}`]);
  if (!points.every((p) => corners.has(`${p[0]},${p[1]}`))) return null;
  return { x: b.minX, y: b.minY, w: b.maxX - b.minX, h: b.maxY - b.minY };
}

export function rectPoints(x, y, w, h) {
  return [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
}

export function edgeLength(a, b) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

// Округление площадей до 0,1 м², как в документах.
export function fmtArea(m2) {
  return m2.toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

export function fmtLen(cm) {
  return (cm / 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Сводка, как в техпаспорте: общая площадь без летних помещений, жилая, кухня.
// Каждую комнату округляем до 0,1 м², чтобы итог сходился с суммой подписей на плане.
export function summarize(rooms = []) {
  const r = (x) => Math.round(x * 10) / 10;
  let total = 0, living = 0, kitchen = 0, outdoor = 0, livingCount = 0;
  for (const room of rooms) {
    const a = r(roomArea(room));
    const t = ROOM_TYPES[room.type] || ROOM_TYPES.room;
    if (t.outdoor) { outdoor += a; continue; }
    total += a;
    if (t.living) { living += a; livingCount++; }
    if (t.kitchen) kitchen += a;
  }
  return { total: r(total), living: r(living), kitchen: r(kitchen), outdoor: r(outdoor), livingCount };
}

// Площадь комнаты с учётом ручной правки (если риелтор ввёл её сам).
export function roomArea(room) {
  return room.areaOverride ?? areaM2(room.points);
}

function insidePolygon([x, y], points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i], [xj, yj] = points[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Куда поставить подпись комнаты размером boxW×boxH: в центр, а если там мебель —
// в ближайшее место внутри комнаты, где мебель перекрывает подпись меньше всего.
export function labelPos(room, boxW, boxH) {
  const center = centroid(room.points);
  const items = (room.furniture || []).map((f) => furnitureRect(room, f)).filter(Boolean);
  const overlap = ([x, y]) => items.reduce((sum, r) => {
    const w = Math.min(x + boxW / 2, r.x + r.w) - Math.max(x - boxW / 2, r.x);
    const h = Math.min(y + boxH / 2, r.y + r.h) - Math.max(y - boxH / 2, r.y);
    return sum + (w > 0 && h > 0 ? w * h : 0);
  }, 0);
  if (!overlap(center)) return center;
  const fits = ([x, y]) => [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .every(([sx, sy]) => insidePolygon([x + sx * boxW / 2, y + sy * boxH / 2], room.points));
  const b = bounds(room.points);
  const N = 12;
  let best = center, bestOverlap = overlap(center), bestDist = 0;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const p = [b.minX + (b.maxX - b.minX) * i / N, b.minY + (b.maxY - b.minY) * j / N];
      if (!fits(p)) continue;
      const o = overlap(p), dist = Math.hypot(p[0] - center[0], p[1] - center[1]);
      if (o < bestOverlap || (o === bestOverlap && dist < bestDist)) { best = p; bestOverlap = o; bestDist = dist; }
    }
  }
  return best;
}

// Прямоугольник для мебели внутри комнаты с учётом примыкания к стене.
export function furnitureRect(room, item) {
  const f = FURNITURE[item.type];
  if (!f) return null;
  const b = bounds(room.points);
  const [cx, cy] = centroid(room.points);
  // lw×lh — собственный размер (ширина и глубина), w×h — место на плане с учётом поворота.
  const lw = item.w ?? f.w, lh = item.h ?? f.h, rot = item.rot || 0;
  const w = rot % 180 ? lh : lw, h = rot % 180 ? lw : lh;
  let x, y;
  if (item.x != null && item.y != null) {
    // Мебель уже двигали — используем сохранённые координаты (центр).
    x = item.x - w / 2;
    y = item.y - h / 2;
    return { x, y, w, h, lw, lh, rot };
  }
  const gap = item.gap ?? 5;
  switch (item.anchor) {
    case 'left':   x = b.minX + gap;       y = cy - h / 2; break;
    case 'right':  x = b.maxX - w - gap;   y = cy - h / 2; break;
    case 'top':    x = cx - w / 2;         y = b.minY + gap; break;
    case 'bottom': x = cx - w / 2;         y = b.maxY - h - gap; break;
    case 'corner': x = b.minX + gap;       y = b.minY + gap; break;
    default:       x = cx - w / 2;         y = cy - h / 2;
  }
  return { x, y, w, h, lw, lh, rot };
}
