// Условные обозначения мебели, вид сверху.
// Рисуются в координатах (0,0)–(w,h), поэтому тянутся под реальный размер. Сторона y = 0 — к стене.
const SHADE = '#e6e0d3';

const rect = (x, y, w, h, rx = 0, fill = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"${fill ? ` fill="${fill}"` : ''}/>`;
const line = (x1, y1, x2, y2) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
const circle = (cx, cy, r, fill = '') => `<circle cx="${cx}" cy="${cy}" r="${r}"${fill ? ` fill="${fill}"` : ''}/>`;
const ellipse = (cx, cy, rx, ry, fill = '') => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"${fill ? ` fill="${fill}"` : ''}/>`;

function sofa(w, h) {
  const m = Math.min(w, h);
  const arm = Math.min(w * 0.14, h * 0.24), back = h * 0.26;
  const seats = Math.max(1, Math.round((w - arm * 2) / (h * 0.75)));
  let out = rect(0, 0, w, h, m * 0.1) + rect(0, 0, w, back, m * 0.08, SHADE)
    + rect(0, 0, arm, h, m * 0.08, SHADE) + rect(w - arm, 0, arm, h, m * 0.08, SHADE);
  for (let i = 1; i < seats; i++) {
    const x = arm + (w - arm * 2) * i / seats;
    out += line(x, back, x, h);
  }
  return out;
}

function bed(w, h) {
  const pillows = w >= 120 ? 2 : 1;
  const gap = w * 0.05, pw = (w - gap * (pillows + 1)) / pillows;
  let out = rect(0, 0, w, h, Math.min(w, h) * 0.03) + rect(0, 0, w, h * 0.06, 0, SHADE);
  for (let i = 0; i < pillows; i++) out += rect(gap + i * (pw + gap), h * 0.09, pw, h * 0.16, h * 0.03, SHADE);
  return out + line(0, h * 0.32, w, h * 0.32) + line(w * 0.7, h * 0.32, w, h * 0.5);
}

function wardrobe(w, h) {
  const hangers = Math.max(3, Math.round(w / 30));
  let out = rect(0, 0, w, h) + line(0, h * 0.5, w, h * 0.5);
  for (let i = 1; i <= hangers; i++) {
    const x = w * i / (hangers + 1);
    out += line(x, h * 0.26, x, h * 0.74);
  }
  return out;
}

function table(w, h) {
  const m = Math.min(w, h);
  const cw = m * 0.3, ch = h * 0.13;
  const xs = w >= 100 ? [w * 0.3, w * 0.7] : [w / 2];
  let out = '';
  for (const x of xs) {
    out += rect(x - cw / 2, 0, cw, ch, ch * 0.3, SHADE) + rect(x - cw / 2, h - ch, cw, ch, ch * 0.3, SHADE);
  }
  return out + rect(w * 0.06, h * 0.17, w * 0.88, h * 0.66, m * 0.05);
}

function chair(w, h) {
  const m = Math.min(w, h);
  return rect(0, h * 0.2, w, h * 0.8, m * 0.12) + rect(w * 0.06, 0, w * 0.88, h * 0.16, m * 0.06, SHADE);
}

function burners(x, y, w, h) {
  const r = Math.min(w, h) * 0.15;
  return [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]
    .map(([kx, ky]) => circle(x + w * kx, y + h * ky, r, SHADE)).join('');
}

function kitchen(w, h) {
  const s = Math.min(h * 0.74, w * 0.3);
  const y = (h - s) / 2;
  const sink = rect(w * 0.62, y + s * 0.14, s, s * 0.72, s * 0.1, SHADE);
  return rect(0, 0, w, h) + burners(w * 0.1, y, s, s) + sink + circle(w * 0.62 + s / 2, y + s * 0.5, s * 0.06)
    + line(0, h * 0.94, w, h * 0.94);
}

function stove(w, h) {
  return rect(0, 0, w, h) + burners(w * 0.04, h * 0.04, w * 0.92, h * 0.86);
}

function sink(w, h) {
  const m = Math.min(w, h);
  return rect(0, 0, w, h) + rect(w * 0.13, h * 0.26, w * 0.74, h * 0.62, m * 0.1, SHADE)
    + circle(w / 2, h * 0.57, m * 0.06) + circle(w / 2, h * 0.13, m * 0.06);
}

function fridge(w, h) {
  const m = Math.min(w, h);
  const cx = w / 2, cy = h * 0.42, r = m * 0.25;
  let out = rect(0, 0, w, h, m * 0.04) + line(0, h * 0.84, w, h * 0.84);
  for (const a of [0, 60, 120]) {
    const dx = r * Math.cos(a * Math.PI / 180), dy = r * Math.sin(a * Math.PI / 180);
    out += line(cx - dx, cy - dy, cx + dx, cy + dy);
  }
  return out;
}

function toilet(w, h) {
  const m = Math.min(w, h);
  return rect(w * 0.08, 0, w * 0.84, h * 0.24, m * 0.05, SHADE)
    + ellipse(w / 2, h * 0.62, w * 0.42, h * 0.37)
    + ellipse(w / 2, h * 0.64, w * 0.25, h * 0.23, SHADE);
}

function bathTub(w, h) {
  const m = Math.min(w, h), inset = m * 0.1;
  return rect(0, 0, w, h, m * 0.08)
    + rect(inset, inset, w - inset * 2, h - inset * 2, m * 0.28, SHADE)
    + circle(w * 0.82, h / 2, m * 0.06) + rect(0, h * 0.42, inset * 1.3, h * 0.16, m * 0.02);
}

function shower(w, h) {
  const m = Math.min(w, h);
  return rect(0, 0, w, h) + line(0, 0, w, h) + line(w, 0, 0, h) + circle(w / 2, h / 2, m * 0.08, SHADE);
}

function washbasin(w, h) {
  const m = Math.min(w, h);
  return rect(w * 0.3, 0, w * 0.4, h * 0.12, m * 0.02, SHADE)
    + ellipse(w / 2, h * 0.56, w * 0.48, h * 0.44)
    + ellipse(w / 2, h * 0.58, w * 0.33, h * 0.28, SHADE) + circle(w / 2, h * 0.58, m * 0.05);
}

const SYMBOLS = {
  sofa, armchair: sofa, bed, bedSingle: bed, wardrobe, table, chairs: chair, kitchen, stove, sink, fridge,
  toilet, bathTub, shower, washbasin,
};

export function furnitureSymbol(type, w, h) {
  return (SYMBOLS[type] || ((a, b) => rect(0, 0, a, b)))(w, h);
}

// Значок для кнопки: тот же символ, что и на плане.
export function furnitureIcon(type, w, h) {
  return `<svg class="furn-ico" viewBox="-2 -2 ${w + 4} ${h + 4}" fill="#fffdf8" stroke="#3a403d"
    stroke-width="${Math.max(w, h) / 22}" stroke-linejoin="round" aria-hidden="true">${furnitureSymbol(type, w, h)}</svg>`;
}
