// Двери, окна и проёмы. Проём «сидит» на стене комнаты: привязан к её ребру (edge)
// и положению центра вдоль ребра (t от 0 до 1), поэтому едет вместе с комнатой.
// { id, type: 'door' | 'window' | 'arch', roomId, edge, t, width (см), swing: 'in' | 'out', hinge: 'a' | 'b' }
import { edgeLength } from './geometry.js';

export const OPENING_TYPES = {
  door:   { label: 'Дверь',  width: 80 },
  window: { label: 'Окно',   width: 120 },
  arch:   { label: 'Проём без двери', width: 90 },
};

const MIN_W = 30;

function signedArea(points) {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length];
    s += x1 * y2 - x2 * y1;
  }
  return s;
}

// Наружная нормаль ребра i (по направлению обхода контура, работает и для Г-образных комнат).
function outward(points, i) {
  const a = points[i], b = points[(i + 1) % points.length];
  const len = edgeLength(a, b) || 1;
  const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  return signedArea(points) > 0 ? [uy, -ux] : [-uy, ux];
}

// Геометрия проёма в мировых координатах или null, если комнаты/ребра больше нет.
export function openingGeom(plan, o) {
  const room = plan.rooms.find((r) => r.id === o.roomId);
  if (!room || o.edge >= room.points.length) return null;
  const a = room.points[o.edge], b = room.points[(o.edge + 1) % room.points.length];
  const len = edgeLength(a, b);
  if (len < MIN_W) return null;
  const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const out = outward(room.points, o.edge);
  const w = Math.min(o.width, len);
  const c = Math.min(Math.max(o.t * len, w / 2), len - w / 2);
  const p0 = [a[0] + u[0] * (c - w / 2), a[1] + u[1] * (c - w / 2)];
  const p1 = [a[0] + u[0] * (c + w / 2), a[1] + u[1] * (c + w / 2)];
  return { p0, p1, u, out, w, wall: plan.wallCm, edgeLen: len, center: c };
}

// Ближайшее ребро к точке (в пределах tol см от стены). Возвращает { roomId, edge, t, dist }.
export function nearestEdge(plan, [px, py], tol) {
  let best = null;
  for (const room of plan.rooms) {
    const pts = room.points;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      const len = edgeLength(a, b);
      if (len < MIN_W) continue;
      const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
      const along = Math.min(Math.max((px - a[0]) * ux + (py - a[1]) * uy, 0), len);
      const qx = a[0] + ux * along, qy = a[1] + uy * along;
      // Расстояние меряем до середины толщины стены — туда пользователь и целится.
      const [ox, oy] = outward(pts, i);
      const mx = qx + ox * plan.wallCm / 2, my = qy + oy * plan.wallCm / 2;
      const dist = Math.hypot(px - mx, py - my);
      if (dist <= tol + plan.wallCm / 2 && (!best || dist < best.dist)) {
        best = { roomId: room.id, edge: i, t: along / len, dist, len };
      }
    }
  }
  return best;
}

export function snapT(t, len, step = 5) {
  return Math.round((t * len) / step) * step / len;
}

const P = (p) => `${p[0]},${p[1]}`;
const add = (p, v, k) => [p[0] + v[0] * k, p[1] + v[1] * k];

// SVG проёма. attrs — атрибуты для «зоны нажатия» (только в редакторе).
export function openingMarkup(plan, o, { attrs = '', ghost = false, selected = false } = {}) {
  const g = openingGeom(plan, o);
  if (!g) return '';
  const { p0, p1, u, out, w, wall } = g;
  const line = Math.max(1.2, wall * 0.14);
  const ink = selected ? '#d9822b' : '#2b2f2d';
  // Вырез в стене (с небольшим запасом, чтобы не оставалось волосков от обводки).
  const cut = [add(p0, out, -0.5), add(p1, out, -0.5), add(p1, out, wall + 0.5), add(p0, out, wall + 0.5)];
  let s = `<g${ghost ? ' opacity=".55"' : ''}>`;
  s += `<polygon points="${cut.map(P).join(' ')}" fill="#fffdf8"/>`;

  if (o.type === 'window') {
    const q0 = add(p0, out, wall), q1 = add(p1, out, wall);
    s += `<polygon points="${[p0, p1, q1, q0].map(P).join(' ')}" fill="#e6f0f2" stroke="${ink}" stroke-width="${line}"/>`;
    s += `<line x1="${add(p0, out, wall / 2)[0]}" y1="${add(p0, out, wall / 2)[1]}" x2="${add(p1, out, wall / 2)[0]}"
      y2="${add(p1, out, wall / 2)[1]}" stroke="${ink}" stroke-width="${line * 0.8}"/>`;
  } else {
    // Косяки проёма.
    for (const p of [p0, p1]) {
      const q = add(p, out, wall);
      s += `<line x1="${p[0]}" y1="${p[1]}" x2="${q[0]}" y2="${q[1]}" stroke="${ink}" stroke-width="${line}"/>`;
    }
    if (o.type === 'door') {
      const inward = o.swing === 'out' ? out : [-out[0], -out[1]];
      const shift = o.swing === 'out' ? wall : 0;          // наружу дверь открывается от внешней грани стены
      const hinge = add(o.hinge === 'b' ? p1 : p0, out, shift);
      const other = add(o.hinge === 'b' ? p0 : p1, out, shift);
      const leaf = add(hinge, inward, w);
      const v1 = [leaf[0] - hinge[0], leaf[1] - hinge[1]], v2 = [other[0] - hinge[0], other[1] - hinge[1]];
      const sweep = v1[0] * v2[1] - v1[1] * v2[0] > 0 ? 1 : 0;
      s += `<line x1="${hinge[0]}" y1="${hinge[1]}" x2="${leaf[0]}" y2="${leaf[1]}" stroke="${ink}" stroke-width="${line * 1.4}"/>`;
      s += `<path d="M ${P(leaf)} A ${w} ${w} 0 0 ${sweep} ${P(other)}" fill="none" stroke="${ink}"
        stroke-width="${line * 0.7}" stroke-dasharray="${line * 3} ${line * 2}"/>`;
    }
  }
  if (attrs) {
    // Невидимая зона нажатия чуть шире стены.
    const pad = Math.max(wall, 20);
    const hit = [add(p0, out, -pad), add(p1, out, -pad), add(p1, out, wall + pad), add(p0, out, wall + pad)];
    s += `<polygon points="${hit.map(P).join(' ')}" fill="transparent" ${attrs}/>`;
  }
  return `${s}</g>`;
}

export function openingsMarkup(plan, opts) {
  return (plan.openings || []).map((o) => openingMarkup(plan, o, opts?.(o))).join('');
}
