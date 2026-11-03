// Обработка фото на устройстве: уменьшение, водяной знак (логотип + подпись), JPEG.

export const DEFAULT_MARK = {
  enabled: true,
  logo: null,        // Blob (PNG с прозрачностью — лучше всего)
  text: '',          // подпись: имя, телефон, агентство
  position: 'br',    // tl | tr | bl | br | center
  size: 18,          // размер логотипа, % от короткой стороны фото
  opacity: 70,       // %
};

export const PHOTO_MAX = 2560;  // так храним и выгружаем
export const THUMB_MAX = 480;   // для сетки и превью

export function canvasToBlob(canvas, type = 'image/jpeg', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Не удалось сохранить изображение'))), type, quality);
  });
}

export async function loadBitmap(blob) {
  return createImageBitmap(blob, { imageOrientation: 'from-image' });
}

// Рисует знак поверх уже нарисованного фото размером W×H.
// Все размеры — доли от короткой стороны, поэтому превью и итоговый файл выглядят одинаково.
export function drawWatermark(ctx, W, H, mark, logo) {
  if (!mark?.enabled) return;
  const text = (mark.text || '').trim();
  if (!logo && !text) return;

  const base = Math.min(W, H);
  const center = mark.position === 'center';
  const margin = base * 0.035;

  let lw = 0, lh = 0;
  if (logo) {
    const k = (base * mark.size / 100) / Math.max(logo.width, logo.height);
    lw = logo.width * k;
    lh = logo.height * k;
  }

  const fs = base * (center ? 0.045 : 0.032);
  ctx.save();
  ctx.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif`;
  const tw = text ? ctx.measureText(text).width : 0;
  const gap = logo && text ? fs * 0.45 : 0;
  const blockW = Math.max(lw, tw);
  const blockH = lh + gap + (text ? fs * 1.15 : 0);

  const align = center ? 'center' : mark.position.endsWith('l') ? 'left' : 'right';
  const bx = center ? (W - blockW) / 2 : align === 'left' ? margin : W - margin - blockW;
  const by = center ? (H - blockH) / 2 : mark.position.startsWith('t') ? margin : H - margin - blockH;
  const ax = align === 'left' ? bx : align === 'right' ? bx + blockW : bx + blockW / 2;

  ctx.globalAlpha = mark.opacity / 100;
  if (logo) {
    const lx = align === 'left' ? bx : align === 'right' ? bx + blockW - lw : bx + (blockW - lw) / 2;
    ctx.drawImage(logo, lx, by, lw, lh);
  }
  if (text) {
    ctx.textAlign = align;
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,.6)';
    ctx.shadowBlur = fs * 0.3;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, ax, by + lh + gap);
  }
  ctx.restore();
}

// Фото (Blob) → новое JPEG-фото не больше maxSide, при необходимости со знаком.
// Значения по умолчанию для «улучшайзера»: как раз чтобы вытянуть тёмные интерьеры.
export const DEFAULT_ADJUST = { brightness: 0, contrast: 0, saturation: 0, auto: false };

// CSS-фильтр из ползунков. Canvas 2D поддерживает ctx.filter в современных браузерах.
export function adjustFilter(adj) {
  if (!adj) return 'none';
  const b = 100 + (adj.brightness || 0);
  const c = 100 + (adj.contrast || 0);
  const s = 100 + (adj.saturation || 0);
  if (b === 100 && c === 100 && s === 100) return 'none';
  return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
}

// Попиксельно те же формулы, что у CSS-фильтров: для браузеров без ctx.filter (Safari).
export function applyAdjustPixels(ctx, w, h, adj) {
  const b = 1 + (adj.brightness || 0) / 100;
  const c = 1 + (adj.contrast || 0) / 100;
  const s = 1 + (adj.saturation || 0) / 100;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = (d[i] * b - 127.5) * c + 127.5;
    const g = (d[i + 1] * b - 127.5) * c + 127.5;
    const v = (d[i + 2] * b - 127.5) * c + 127.5;
    const gray = 0.2126 * r + 0.7152 * g + 0.0722 * v;
    d[i] = gray + (r - gray) * s;
    d[i + 1] = gray + (g - gray) * s;
    d[i + 2] = gray + (v - gray) * s;
  }
  ctx.putImageData(img, 0, 0);
}

// Рисует фото на canvas с учётом ползунков улучшения.
export function drawAdjusted(ctx, src, w, h, adj) {
  const f = adjustFilter(adj);
  if (f === 'none') { ctx.drawImage(src, 0, 0, w, h); return; }
  if ('filter' in ctx) {
    ctx.filter = f;
    ctx.drawImage(src, 0, 0, w, h);
    ctx.filter = 'none';
    return;
  }
  ctx.drawImage(src, 0, 0, w, h);
  applyAdjustPixels(ctx, w, h, adj);
}

export async function renderPhoto(source, { maxSide = PHOTO_MAX, quality = 0.9, mark = null, logo = null, adjust = null } = {}) {
  const bmp = source instanceof Blob ? await loadBitmap(source) : source;
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  drawAdjusted(ctx, bmp, canvas.width, canvas.height, adjust);
  if (source instanceof Blob) bmp.close?.();
  drawWatermark(ctx, canvas.width, canvas.height, mark, logo);
  const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob, w: canvas.width, h: canvas.height };
}

// Логотип храним как PNG не больше 800 px, чтобы сохранить прозрачность.
export async function prepareLogo(file) {
  const bmp = await loadBitmap(file);
  const k = Math.min(1, 800 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvasToBlob(canvas, 'image/png');
}
