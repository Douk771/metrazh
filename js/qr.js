// Генератор QR-кода без библиотек: байтовый режим, коррекция ошибок уровня M.
// makeQr(text) возвращает { size, get(x, y) }; get даёт true для тёмного модуля.

// По таблицам стандарта ISO/IEC 18004 для уровня M, индекс — номер версии.
const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
const NUM_BLOCKS = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];
const LEVEL_M_BITS = 0;

function rawDataModules(ver) {
  let n = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const align = Math.floor(ver / 7) + 2;
    n -= (25 * align - 10) * align - 55;
    if (ver >= 7) n -= 36;
  }
  return n;
}
const dataCodewords = (ver) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ver] * NUM_BLOCKS[ver];

// Арифметика в поле GF(256) с многочленом 0x11D.
function gfMul(a, b) {
  let r = 0;
  for (let i = 7; i >= 0; i--) {
    r = (r << 1) ^ ((r >>> 7) * 0x11d);
    r ^= ((b >>> i) & 1) * a;
  }
  return r & 0xff;
}

function rsDivisor(degree) {
  const out = new Array(degree).fill(0);
  out[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      out[j] = gfMul(out[j], root);
      if (j + 1 < degree) out[j] ^= out[j + 1];
    }
    root = gfMul(root, 2);
  }
  return out;
}

function rsRemainder(data, divisor) {
  const out = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ out.shift();
    out.push(0);
    divisor.forEach((d, i) => { out[i] ^= gfMul(d, factor); });
  }
  return out;
}

function encodeData(bytes, ver) {
  const bits = [];
  const put = (value, length) => { for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, ver <= 9 ? 8 : 16);
  bytes.forEach((b) => put(b, 8));
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return out;
}

function withErrorCorrection(data, ver) {
  const blocksTotal = NUM_BLOCKS[ver], ecc = ECC_PER_BLOCK[ver];
  const rawCodewords = Math.floor(rawDataModules(ver) / 8);
  const shortBlocks = blocksTotal - rawCodewords % blocksTotal;
  const shortLen = Math.floor(rawCodewords / blocksTotal);
  const divisor = rsDivisor(ecc);
  const dataBlocks = [], eccBlocks = [];
  for (let i = 0, pos = 0; i < blocksTotal; i++) {
    const len = shortLen - ecc + (i < shortBlocks ? 0 : 1);
    const block = data.slice(pos, pos + len);
    pos += len;
    dataBlocks.push(block);
    eccBlocks.push(rsRemainder(block, divisor));
  }
  // Кодовые слова блоков чередуются: сначала данные, потом коррекция.
  const out = [];
  for (let i = 0; i <= shortLen - ecc; i++) {
    dataBlocks.forEach((b) => { if (i < b.length) out.push(b[i]); });
  }
  for (let i = 0; i < ecc; i++) eccBlocks.forEach((b) => out.push(b[i]));
  return out;
}

function alignmentPositions(ver) {
  if (ver === 1) return [];
  const count = Math.floor(ver / 7) + 2;
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = ver * 4 + 10; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => (x * y) % 2 + (x * y) % 3 === 0,
  (x, y) => ((x * y) % 2 + (x * y) % 3) % 2 === 0,
  (x, y) => ((x + y) % 2 + (x * y) % 3) % 2 === 0,
];

function penalty(m, size) {
  let score = 0;
  const lineScore = (line) => {
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) { run++; continue; }
      if (run >= 5) score += run - 2;
      run = 1;
    }
    const s = line.map((v) => (v ? 1 : 0)).join('');
    for (let i = s.indexOf('1011101'); i !== -1; i = s.indexOf('1011101', i + 1)) {
      if (s.slice(Math.max(0, i - 4), i) === '0000' || s.slice(i + 7, i + 11) === '0000') score += 40;
    }
  };
  for (let y = 0; y < size; y++) lineScore(m[y]);
  for (let x = 0; x < size; x++) lineScore(m.map((row) => row[x]));
  let dark = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (m[y][x]) dark++;
      if (x + 1 < size && y + 1 < size && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3;
    }
  }
  return score + Math.floor(Math.abs(dark * 20 / (size * size) - 10)) * 10;
}

export function makeQr(text) {
  const bytes = [...new TextEncoder().encode(text)];
  let ver = 1;
  while (ver <= 40 && bytes.length + (ver <= 9 ? 2 : 3) > dataCodewords(ver)) ver++;
  if (ver > 40) throw new Error('Слишком много данных для QR-кода');

  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));
  const fixed = (x, y, dark) => { modules[y][x] = dark; reserved[y][x] = true; };

  // Поисковые узоры в трёх углах.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx, y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        fixed(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Линии синхронизации.
  for (let i = 8; i < size - 8; i++) { fixed(6, i, i % 2 === 0); fixed(i, 6, i % 2 === 0); }
  // Выравнивающие узоры.
  const align = alignmentPositions(ver);
  const last = align.length - 1;
  align.forEach((ay, row) => {
    align.forEach((ax, col) => {
      // Только три угла заняты поисковыми узорами; на линиях синхронизации узор ставится.
      if ((row === 0 && col === 0) || (row === 0 && col === last) || (row === last && col === 0)) return;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) fixed(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    });
  });

  const drawFormat = (m, mask) => {
    const data = (LEVEL_M_BITS << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) !== 0;
    const set = (x, y, dark) => { m[y][x] = dark; reserved[y][x] = true; };
    for (let i = 0; i <= 5; i++) set(8, i, bit(i));
    set(8, 7, bit(6));
    set(8, 8, bit(7));
    set(7, 8, bit(8));
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
    set(8, size - 8, true);
  };
  drawFormat(modules, 0);

  if (ver >= 7) {
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const dark = ((bits >>> i) & 1) !== 0;
      const a = size - 11 + i % 3, b = Math.floor(i / 3);
      fixed(a, b, dark);
      fixed(b, a, dark);
    }
  }

  // Данные укладываются зигзагом снизу справа.
  const codewords = withErrorCorrection(encodeData(bytes, ver), ver);
  let bitIndex = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let v = 0; v < size; v++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - v : v;
        if (reserved[y][x] || bitIndex >= codewords.length * 8) continue;
        modules[y][x] = ((codewords[bitIndex >>> 3] >>> (7 - (bitIndex & 7))) & 1) !== 0;
        bitIndex++;
      }
    }
  }

  // Выбираем маску с наименьшим штрафом.
  const masked = (mask) => {
    const m = modules.map((row) => [...row]);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (!reserved[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x];
      }
    }
    drawFormat(m, mask);
    return m;
  };
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = masked(mask), score = penalty(m, size);
    if (score < bestScore) { best = m; bestScore = score; }
  }
  return { size, version: ver, get: (x, y) => best[y][x] };
}

// Рисует код на canvas с белым полем в 4 модуля, как требует стандарт.
export function drawQr(ctx, qr, x, y, side) {
  // Целый размер модуля: так края чёткие и код легче читается.
  const cell = Math.max(1, Math.floor(side / (qr.size + 8)));
  const offset = Math.floor((side - cell * qr.size) / 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, side, side);
  ctx.fillStyle = '#000000';
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (qr.get(col, row)) ctx.fillRect(x + offset + col * cell, y + offset + row * cell, cell, cell);
    }
  }
}
