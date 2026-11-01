// Геометрия планировки. Все координаты — в сантиметрах.
// Контур комнаты — её внутренний контур (как в БТИ), стены рисуются снаружи.

export const ROOM_TYPES = {
  room:    { label: 'Жилая комната', short: 'Комната', fill: '#e9e1cf', living: true },
  kitchen: { label: 'Кухня',         short: 'Кухня',   fill: '#f1d9b5' },
  bath:    { label: 'Ванная',        short: 'Ванная',  fill: '#cfe3e6' },
  wc:      { label: 'Туалет',        short: 'Туалет',  fill: '#cfe3e6' },
  combo:   { label: 'Совмещённый санузел', short: 'С/у', fill: '#cfe3e6' },
  hall:    { label: 'Прихожая / коридор', short: 'Коридор', fill: '#e4e4dc' },
  storage: { label: 'Кладовая / гардероб', short: 'Кладовая', fill: '#e4e4dc' },
  balcony: { label: 'Балкон',        short: 'Балкон',  fill: '#dfe8d4', outdoor: true },
  loggia:  { label: 'Лоджия',        short: 'Лоджия',  fill: '#dfe8d4', outdoor: true },
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
export function summarize(rooms) {
  const r = (x) => Math.round(x * 10) / 10;
  let total = 0, living = 0, kitchen = 0, outdoor = 0, livingCount = 0;
  for (const room of rooms) {
    const a = r(room.areaOverride ?? areaM2(room.points));
    const t = ROOM_TYPES[room.type] || ROOM_TYPES.room;
    if (t.outdoor) { outdoor += a; continue; }
    total += a;
    if (t.living) { living += a; livingCount++; }
    if (room.type === 'kitchen') kitchen += a;
  }
  return { total: r(total), living: r(living), kitchen: r(kitchen), outdoor: r(outdoor), livingCount };
}

export function roomArea(room) {
  return room.areaOverride ?? areaM2(room.points);
}
