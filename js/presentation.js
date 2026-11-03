// Вкладка «Презентация»: PDF объекта для покупателя.
// Страницы рисуются на canvas (A4, 150 dpi) и собираются в PDF без библиотек.
import { listPhotos, getSetting, setSetting, downloadBlob, safeName } from './db.js';
import { DEFAULT_MARK, DEFAULT_ADJUST, loadBitmap, renderPhoto, canvasToBlob } from './watermark.js';
import { summarize, fmtArea, roomArea, ROOM_TYPES } from './geometry.js';
import { planSvg } from './editor.js';
import { makePdf } from './pdf.js';
import { makeZip } from './zip.js';
import { canShareImages, createImageShare, imageFile } from './share.js';
import { topbar, bindTopbar, esc } from './ui.js';

const W = 1240, H = 1754, MM = W / 210;      // A4 при 150 dpi
const M = 16 * MM;                            // поля
const CW = W - M * 2;                         // ширина полосы набора
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
const SERIF = 'Georgia, "Times New Roman", serif';
// Палитра из брендбука Метража.
const C = {
  ink: '#1f2b29', ink2: '#5f6f6b', deep: '#2f4a47', mid: '#49635f', sage: '#b7c6bd',
  sand: '#ede4d9', paper: '#faf6f3', peach: '#e6c8b8', white: '#ffffff', line: '#ddd5c9',
};
const STORY_W = 1080, STORY_H = 1920;         // формат сторис 9:16
const pt = (n) => n * 0.3528 * MM;

export const DEFAULT_AGENT = { name: '', phone: '', agency: '' };

const canSharePdf = (() => {
  try { return !!navigator.canShare?.({ files: [new File([''], 'a.pdf', { type: 'application/pdf' })] }); } catch { return false; }
})();

// ---------- рисование ----------
function newPage(background = C.paper) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  return { canvas: c, ctx };
}

function font(ctx, size, weight = 400, family = FONT) { ctx.font = `${weight} ${pt(size)}px ${family}`; }

function wrap(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    if (!para.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function drawText(ctx, text, x, y, { size = 12, weight = 400, color = C.ink, maxW = CW, lh = 1.4, align = 'left', maxLines = Infinity, family = FONT } = {}) {
  font(ctx, size, weight, family);
  ctx.fillStyle = color;
  ctx.textAlign = align;
  let lines = wrap(ctx, text, maxW);
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S*$/, '') + '…';
  }
  const step = pt(size) * lh;
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * step));
  return y + lines.length * step;
}

function drawCover(ctx, img, x, y, w, h) {
  const k = Math.max(w / img.width, h / img.height);
  const sw = w / k, sh = h / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, h);
}

function drawContain(ctx, img, x, y, w, h) {
  const k = Math.min(w / img.width, h / img.height);
  const dw = img.width * k, dh = img.height * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundedPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function roundedRect(ctx, x, y, w, h, r, color) {
  roundedPath(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

// Фото в скруглённой рамке: близкое по пропорциям заполняет рамку, остальное вписывается целиком.
function drawPhoto(ctx, img, x, y, w, h) {
  ctx.save();
  roundedPath(ctx, x, y, w, h, 5 * MM);
  ctx.clip();
  ctx.fillStyle = C.sand;
  ctx.fillRect(x, y, w, h);
  const ratio = (img.width / img.height) / (w / h);
  if (ratio > 0.8 && ratio < 1.25) drawCover(ctx, img, x, y, w, h);
  else drawContain(ctx, img, x, y, w, h);
  ctx.restore();
}

function header(ctx, title) {
  drawText(ctx, title, M, M + pt(26), { size: 26, family: SERIF, color: C.deep, maxLines: 1 });
  ctx.fillStyle = C.peach;
  ctx.fillRect(M, M + pt(26) + 5 * MM, 18 * MM, 1.4 * MM);
}
const HEADER_H = 26 * MM;

function footer(ctx, d, n, total) {
  const y = H - 9 * MM;
  ctx.fillStyle = C.line;
  ctx.fillRect(M, y - 6 * MM, CW, 1);
  drawText(ctx, [d.project.name, d.agent.agency].filter(Boolean).join(' · '), M, y, { size: 9, color: C.ink2, maxW: CW * 0.7, maxLines: 1 });
  drawText(ctx, `${n} / ${total}`, W - M, y, { size: 9, color: C.ink2, align: 'right' });
}

const fmtPrice = (s) => {
  const n = Number(String(s || '').replace(/[^\d]/g, ''));
  return n ? `${n.toLocaleString('ru-RU')} ₽` : '';
};

function facts(d) {
  const s = d.summary;
  const f = [];
  if (s.livingCount) f.push(['Комнат', String(s.livingCount)]);
  if (s.total) f.push(['Общая', `${fmtArea(s.total)} м²`]);
  if (s.living) f.push(['Жилая', `${fmtArea(s.living)} м²`]);
  if (s.kitchen) f.push(['Кухня', `${fmtArea(s.kitchen)} м²`]);
  const p = d.project;
  if (p.floor) f.push(['Этаж', p.floors ? `${p.floor} из ${p.floors}` : String(p.floor)]);
  return f;
}

// Контакты агента. onDark — для тёмного фона обложки.
function agentBlock(ctx, d, y, { onDark = false } = {}) {
  const a = d.agent;
  if (!a.name && !a.phone && !a.agency && !d.logo) return;
  const h = 30 * MM;
  if (!onDark) roundedRect(ctx, M, y, CW, h, 5 * MM, C.sand);
  const inset = onDark ? 0 : 6 * MM;
  let x = M + inset;
  if (d.logo) {
    // Логотип всегда на светлой плашке: он может быть тёмным.
    roundedRect(ctx, x, y + 4 * MM, 38 * MM, 22 * MM, 3 * MM, C.paper);
    drawContain(ctx, d.logo, x + 3 * MM, y + 6 * MM, 32 * MM, 18 * MM);
    x += 44 * MM;
  }
  const maxW = W - M - x - inset;
  let ty = y + 11 * MM;
  if (a.name) ty = drawText(ctx, a.name, x, ty, { size: 14, weight: 700, color: onDark ? C.white : C.ink, maxW, maxLines: 1 });
  if (a.phone) ty = drawText(ctx, a.phone, x, ty + 1 * MM, { size: 13, weight: 600, color: onDark ? C.peach : C.deep, maxW, maxLines: 1 });
  if (a.agency) drawText(ctx, a.agency, x, ty + 1 * MM, { size: 10, color: onDark ? C.sage : C.ink2, maxW, maxLines: 1 });
}

function pageCover(d) {
  const { canvas, ctx } = newPage(C.deep);
  const heroH = 142 * MM;
  if (d.photos[0]) {
    drawCover(ctx, d.photos[0], 0, 0, W, heroH);
  } else {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, heroH);
    if (d.plan) drawContain(ctx, d.plan, M, 10 * MM, CW, heroH - 20 * MM);
  }

  let y = heroH + 18 * MM;
  y = drawText(ctx, d.project.name || 'Объект', M, y, { size: 28, family: SERIF, color: C.white, maxLines: 2, lh: 1.15 });
  if (d.project.address) y = drawText(ctx, d.project.address, M, y + 1 * MM, { size: 12, color: C.sage, maxLines: 2 });
  const price = fmtPrice(d.project.price);
  if (price) y = drawText(ctx, price, M, y + 10 * MM, { size: 30, family: SERIF, color: C.peach, maxLines: 1 });

  const f = facts(d);
  if (f.length) {
    y += 8 * MM;
    const bw = CW / f.length;
    f.forEach(([label, value], i) => {
      const x = M + i * bw;
      if (i) {
        ctx.fillStyle = 'rgba(255,255,255,.22)';
        ctx.fillRect(x - 3 * MM, y, 1, 15 * MM);
      }
      drawText(ctx, label, x, y + 4 * MM, { size: 9.5, color: C.sage, maxW: bw - 6 * MM, maxLines: 1 });
      drawText(ctx, value, x, y + 13 * MM, { size: f.length > 4 ? 13 : 15, weight: 700, color: C.white, maxW: bw - 6 * MM, maxLines: 1 });
    });
  }

  agentBlock(ctx, d, H - M - 26 * MM, { onDark: true });
  return canvas;
}

function pagePlan(d) {
  const { canvas, ctx } = newPage();
  header(ctx, 'Планировка');
  const top = M + HEADER_H;
  const rooms = d.project.plan.rooms;
  const twoCols = rooms.length > 6;
  const rowH = 8 * MM;
  const rows = twoCols ? Math.ceil(rooms.length / 2) : rooms.length;
  const planH = H - top - rows * rowH - 72 * MM;
  roundedRect(ctx, M, top, CW, planH, 5 * MM, C.white);
  drawContain(ctx, d.plan, M + 6 * MM, top + 6 * MM, CW - 12 * MM, planH - 12 * MM);

  let y = top + planH + 11 * MM;
  const colW = twoCols ? (CW - 10 * MM) / 2 : CW;
  rooms.forEach((r, i) => {
    const col = twoCols && i >= rows ? 1 : 0;
    const row = col ? i - rows : i;
    const x = M + col * (colW + 10 * MM), ry = y + row * rowH;
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.room;
    ctx.beginPath();
    ctx.arc(x + 1.8 * MM, ry - 1.5 * MM, 1.8 * MM, 0, Math.PI * 2);
    ctx.fillStyle = t.tone || t.fill;
    ctx.fill();
    drawText(ctx, r.name || t.short, x + 6 * MM, ry, { size: 11, maxW: colW - 30 * MM, maxLines: 1 });
    drawText(ctx, `${fmtArea(roomArea(r))} м²`, x + colW, ry, { size: 11, weight: 600, align: 'right' });
    ctx.fillStyle = C.line;
    ctx.fillRect(x, ry + 2.8 * MM, colW, 1);
  });

  y += rows * rowH + 3 * MM;
  const s = d.summary;
  const totals = [['Общая площадь', s.total], ['Жилая', s.living], ['Кухня', s.kitchen], ['Балконы и лоджии', s.outdoor]]
    .filter(([, v]) => v);
  roundedRect(ctx, M, y, CW, 22 * MM, 5 * MM, C.deep);
  const tw = (CW - 12 * MM) / Math.max(1, totals.length);
  totals.forEach(([label, v], i) => {
    const x = M + 6 * MM + i * tw;
    drawText(ctx, label, x, y + 8.5 * MM, { size: 9, color: C.sage, maxW: tw - 3 * MM, maxLines: 1 });
    drawText(ctx, `${fmtArea(v)} м²`, x, y + 16.5 * MM, { size: 14, weight: 700, color: C.white, maxW: tw - 3 * MM, maxLines: 1 });
  });
  drawText(ctx, 'Площади указаны по внутреннему контуру помещений.', M, y + 28 * MM, { size: 8.5, color: C.ink2 });
  return canvas;
}

function pagePhotos(d, pair) {
  const { canvas, ctx } = newPage();
  header(ctx, 'Фотографии');
  const top = M + HEADER_H, gap = 7 * MM;
  const area = H - top - 22 * MM;
  if (pair.length === 1) {
    // Одно фото на странице — по его пропорциям, чтобы не было пустой рамки.
    const h = Math.min(area, CW * pair[0].height / pair[0].width);
    drawPhoto(ctx, pair[0], M, top + (area - h) / 2, CW, h);
    return canvas;
  }
  const boxH = (area - gap) / 2;
  pair.forEach((img, i) => drawPhoto(ctx, img, M, top + i * (boxH + gap), CW, boxH));
  return canvas;
}

function pageAbout(d) {
  const { canvas, ctx } = newPage();
  header(ctx, 'Об объекте');
  let y = M + HEADER_H + 8 * MM;
  // Текст не длиннее места над контактами и подвалом; лишнее обрезается многоточием.
  const agentY = H - M - 40 * MM;
  const maxLines = Math.floor((agentY - 8 * MM - y) / (pt(13) * 1.6));
  drawText(ctx, d.project.description, M, y, { size: 13, lh: 1.6, maxLines });
  agentBlock(ctx, d, agentY);
  return canvas;
}

// Лист в формате сторис: 9:16 на фоне из брендовой растяжки.
export function storyPage(page) {
  const c = document.createElement('canvas');
  c.width = STORY_W; c.height = STORY_H;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, STORY_H);
  g.addColorStop(0, C.mid);
  g.addColorStop(0.55, C.sage);
  g.addColorStop(1, C.sand);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, STORY_W, STORY_H);
  const pw = 960, ph = pw * H / W;
  const x = (STORY_W - pw) / 2, y = (STORY_H - ph) / 2, r = 24;
  ctx.save();
  ctx.shadowColor = 'rgba(31,43,41,.35)';
  ctx.shadowBlur = 50;
  ctx.shadowOffsetY = 16;
  roundedRect(ctx, x, y, pw, ph, r, C.paper);
  ctx.restore();
  ctx.save();
  roundedPath(ctx, x, y, pw, ph, r);
  ctx.clip();
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(page, x, y, pw, ph);
  ctx.restore();
  return c;
}

export function buildPages(d) {
  const pages = [pageCover(d)];
  if (d.plan) pages.push(pagePlan(d));
  const rest = d.photos.slice(1);
  for (let i = 0; i < rest.length; i += 2) pages.push(pagePhotos(d, rest.slice(i, i + 2)));
  if ((d.project.description || '').trim()) pages.push(pageAbout(d));
  // Подвал рисуем, когда известно число страниц (обложка без подвала).
  pages.forEach((c, i) => { if (i > 0) footer(c.getContext('2d'), d, i + 1, pages.length); });
  return pages;
}

async function svgToImage(svg) {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    // Растеризуем с запасом по разрешению, чтобы линии в PDF были чёткими.
    const k = 1800 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1);
    const c = document.createElement('canvas');
    c.width = Math.round((img.naturalWidth || 1) * k);
    c.height = Math.round((img.naturalHeight || 1) * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- экран ----------
export function openPresentation(root, project, { onSave, toast }) {
  let agent = { ...DEFAULT_AGENT };
  let mark = { ...DEFAULT_MARK };
  let adjust = { ...DEFAULT_ADJUST };
  let logo = null;
  let photos = [];
  const photoCache = { true: null, false: null };   // со знаком / без
  let withMark = true;
  let plan = null;
  let pages = [];
  let closed = false;
  let timer = null;
  let busy = false;
  const imageShares = [];

  root.innerHTML = `
    <div class="project-screen">
      ${topbar(project, 'pdf')}
      <main class="pdf-main">
        <section class="pdf-form">
          <h2>Объект</h2>
          <label class="field">Адрес<input id="f-address" value="${esc(project.address)}" placeholder="Город, улица, дом"></label>
          <label class="field">Цена, ₽<input id="f-price" inputmode="numeric" value="${esc(project.price || '')}" placeholder="12 500 000"></label>
          <div class="row">
            <label class="field">Этаж<input id="f-floor" inputmode="numeric" value="${esc(project.floor || '')}"></label>
            <label class="field">Этажей в доме<input id="f-floors" inputmode="numeric" value="${esc(project.floors || '')}"></label>
          </div>
          <label class="field">Описание<textarea id="f-desc" rows="6" placeholder="Чем хорош объект: ремонт, вид из окон, двор, транспорт, документы…">${esc(project.description || '')}</textarea></label>

          <h2>Ваши контакты</h2>
          <p class="muted">Общие для всех объектов. Логотип берётся из настроек водяного знака во вкладке «Фото».</p>
          <label class="field">Имя<input id="a-name" placeholder="Как вас представить"></label>
          <label class="field">Телефон<input id="a-phone" type="tel" placeholder="+7 …"></label>
          <label class="field">Агентство<input id="a-agency"></label>

          <h2>Фото</h2>
          <label class="check"><input type="checkbox" id="f-mark" checked> Водяной знак на фото</label>

          <div class="pdf-actions">
            <button class="btn primary" id="download" disabled>Скачать презентацию</button>
            <button class="btn" id="images" disabled>Листы картинками</button>
            <button class="btn" id="stories" disabled>Для сторис</button>
            ${canSharePdf ? '<button class="btn" id="share" disabled>Поделиться…</button>' : ''}
          </div>
          <p class="muted"><a href="#/help/pdf">Как устроена презентация</a></p>
        </section>
        <section class="pdf-preview">
          <div class="progress" id="progress">Готовлю превью…</div>
          <div class="pages" id="pages"></div>
        </section>
      </main>
    </div>`;

  const $ = (s) => root.querySelector(s);
  bindTopbar(root, project, () => onSave(project));

  const progress = (t) => { const el = $('#progress'); if (el) { el.hidden = !t; el.textContent = t || ''; } };

  // Кэшируем обещание, чтобы повторный вызов во время подготовки не запускал её второй раз.
  function photoBitmaps() {
    const key = String(withMark && mark.enabled);
    photoCache[key] ??= preparePhotos(key);
    return photoCache[key];
  }

  async function preparePhotos(key) {
    const out = [];
    for (let i = 0; i < photos.length; i++) {
      progress(`Готовлю фото ${i + 1} из ${photos.length}…`);
      const { blob } = await renderPhoto(photos[i].blob, {
        maxSide: 1600, quality: 0.92, mark: key === 'true' ? mark : null, logo, adjust,
      });
      out.push(await loadBitmap(blob));
      if (closed) return out;
    }
    return out;
  }

  async function render() {
    const imgs = await photoBitmaps();
    if (closed) return;
    imageShares.forEach((s) => s.reset());
    const d = { project, agent, logo, plan, photos: imgs, summary: summarize(project.plan.rooms) };
    pages = buildPages(d);
    const box = $('#pages');
    box.innerHTML = '';
    pages.forEach((c, i) => {
      const fig = document.createElement('figure');
      fig.className = 'page';
      fig.appendChild(c);
      const cap = document.createElement('figcaption');
      cap.textContent = `Страница ${i + 1}`;
      fig.appendChild(cap);
      box.appendChild(fig);
    });
    progress('');
    $('#download').disabled = false;
    $('#images').disabled = false;
    $('#stories').disabled = false;
    if (canSharePdf) $('#share').disabled = false;
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(render, 500);
  }

  async function buildPdf() {
    const jpegs = [];
    for (let i = 0; i < pages.length; i++) {
      progress(`Собираю PDF: страница ${i + 1} из ${pages.length}…`);
      jpegs.push({ jpeg: await canvasToBlob(pages[i], 'image/jpeg', 0.86), width: W, height: H });
    }
    const pdf = await makePdf(jpegs, { title: project.name });
    progress('');
    return pdf;
  }

  async function guarded(fn) {
    if (busy || !pages.length) return;
    busy = true;
    try { await fn(); } catch (e) {
      if (e?.name !== 'AbortError') toast('Не получилось собрать файл');
    } finally { busy = false; progress(''); }
  }

  $('#download').onclick = () => guarded(async () => {
    downloadBlob(await buildPdf(), `${safeName(project.name)}.pdf`);
  });
  // Каждый лист отдельной картинкой.
  async function pageImages(convert) {
    const files = [];
    for (let i = 0; i < pages.length; i++) {
      progress(`Готовлю картинку ${i + 1} из ${pages.length}…`);
      const blob = await canvasToBlob(convert(pages[i]), 'image/jpeg', 0.9);
      files.push({ name: `${String(i + 1).padStart(2, '0')}.jpg`, blob });
    }
    return files;
  }
  // На телефоне — системное меню, на компьютере и если меню недоступно — архив.
  function bindImages(id, suffix, convert) {
    const share = canShareImages() ? createImageShare({
      button: $(id),
      title: project.name,
      build: async () => (await pageImages(convert))
        .map((f) => imageFile(`${safeName(project.name)} ${suffix} ${f.name}`, f.blob)),
      toast,
    }) : null;
    if (share) imageShares.push(share);
    $(id).onclick = () => guarded(async () => {
      if (share && !(await share.run())) return;
      const files = await pageImages(convert);
      progress('Собираю архив…');
      downloadBlob(await makeZip(files), `${safeName(project.name)} — ${suffix}.zip`);
    });
  }
  bindImages('#images', 'листы', (page) => page);
  bindImages('#stories', 'сторис', storyPage);
  if (canSharePdf) {
    $('#share').onclick = () => guarded(async () => {
      const file = new File([await buildPdf()], `${safeName(project.name)}.pdf`, { type: 'application/pdf' });
      await navigator.share({ files: [file], title: project.name });
    });
  }

  const bindProject = (id, key) => {
    $(id).oninput = (e) => { project[key] = e.target.value.trim(); onSave(project); schedule(); };
  };
  bindProject('#f-address', 'address');
  bindProject('#f-price', 'price');
  bindProject('#f-floor', 'floor');
  bindProject('#f-floors', 'floors');
  $('#f-desc').oninput = (e) => { project.description = e.target.value; onSave(project); schedule(); };
  $('#name').addEventListener('input', (e) => { project.name = e.target.value; schedule(); });

  const bindAgent = (id, key) => {
    $(id).oninput = (e) => { agent[key] = e.target.value.trim(); setSetting('agent', agent); schedule(); };
  };
  $('#f-mark').onchange = (e) => { withMark = e.target.checked; schedule(); };

  (async () => {
    agent = { ...DEFAULT_AGENT, ...(await getSetting('agent', {})) };
    const savedMark = await getSetting('mark', null);
    if (savedMark) mark = { ...DEFAULT_MARK, ...savedMark };
    adjust = { ...DEFAULT_ADJUST, ...(await getSetting('adjust', {})) };
    if (mark.logo) logo = await loadBitmap(mark.logo);
    photos = await listPhotos(project.id);
    const ps = planSvg(project.plan);
    if (ps) plan = await svgToImage(ps.svg);
    if (closed) return;
    $('#a-name').value = agent.name;
    $('#a-phone').value = agent.phone;
    $('#a-agency').value = agent.agency;
    bindAgent('#a-name', 'name');
    bindAgent('#a-phone', 'phone');
    bindAgent('#a-agency', 'agency');
    $('#f-mark').checked = withMark;
    $('#f-mark').disabled = !(mark.enabled && (mark.logo || mark.text?.trim()));
    if ($('#f-mark').disabled) $('#f-mark').closest('label').title = 'Водяной знак не настроен — во вкладке «Фото»';
    render();
  })();

  return async function close() {
    closed = true;
    clearTimeout(timer);
    Object.values(photoCache).forEach((p) => p?.then((arr) => arr.forEach((b) => b.close?.())));
    logo?.close?.();
    await onSave(project);
  };
}
