// Вкладка «Презентация»: PDF объекта для покупателя.
// Страницы рисуются на canvas (A4, 150 dpi) и собираются в PDF без библиотек.
import { listPhotos, getSetting, setSetting, downloadBlob, safeName } from './db.js';
import { DEFAULT_MARK, DEFAULT_ADJUST, loadBitmap, renderPhoto, canvasToBlob } from './watermark.js';
import { summarize, fmtArea, roomArea, ROOM_TYPES } from './geometry.js';
import { planSvg } from './editor.js';
import { makePdf } from './pdf.js';
import { topbar, bindTopbar, esc } from './ui.js';

const W = 1240, H = 1754, MM = W / 210;      // A4 при 150 dpi
const M = 16 * MM;                            // поля
const CW = W - M * 2;                         // ширина полосы набора
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';
const C = { ink: '#1d2321', ink2: '#5b625e', accent: '#1f5f5b', line: '#d6cdbb', paper: '#f4efe6' };
const pt = (n) => n * 0.3528 * MM;

export const DEFAULT_AGENT = { name: '', phone: '', agency: '' };

const canSharePdf = (() => {
  try { return !!navigator.canShare?.({ files: [new File([''], 'a.pdf', { type: 'application/pdf' })] }); } catch { return false; }
})();

// ---------- рисование ----------
function newPage() {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
  return { canvas: c, ctx };
}

function font(ctx, size, weight = 400) { ctx.font = `${weight} ${pt(size)}px ${FONT}`; }

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

function drawText(ctx, text, x, y, { size = 12, weight = 400, color = C.ink, maxW = CW, lh = 1.4, align = 'left', maxLines = Infinity } = {}) {
  font(ctx, size, weight);
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

function header(ctx, title) {
  drawText(ctx, title, M, M + pt(20), { size: 20, weight: 700 });
  ctx.fillStyle = C.accent;
  ctx.fillRect(M, M + pt(20) + 4 * MM, 24 * MM, 1.2 * MM);
}

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

function agentBlock(ctx, d, y) {
  const a = d.agent;
  if (!a.name && !a.phone && !a.agency && !d.logo) return;
  ctx.fillStyle = C.paper;
  ctx.fillRect(M, y, CW, 30 * MM);
  let x = M + 6 * MM;
  if (d.logo) {
    drawContain(ctx, d.logo, x, y + 5 * MM, 34 * MM, 20 * MM);
    x += 40 * MM;
  }
  let ty = y + 11 * MM;
  if (a.name) ty = drawText(ctx, a.name, x, ty, { size: 14, weight: 700, maxW: W - M - x - 6 * MM, maxLines: 1 });
  if (a.phone) ty = drawText(ctx, a.phone, x, ty + 1 * MM, { size: 13, color: C.accent, weight: 600, maxLines: 1 });
  if (a.agency) drawText(ctx, a.agency, x, ty + 1 * MM, { size: 10, color: C.ink2, maxLines: 1 });
}

function pageCover(d) {
  const { canvas, ctx } = newPage();
  const heroH = 128 * MM;
  if (d.photos[0]) {
    drawCover(ctx, d.photos[0], 0, 0, W, heroH);
  } else {
    ctx.fillStyle = C.paper;
    ctx.fillRect(0, 0, W, heroH);
    if (d.plan) drawContain(ctx, d.plan, M, 10 * MM, CW, heroH - 20 * MM);
  }

  let y = heroH + 16 * MM;
  y = drawText(ctx, d.project.name || 'Объект', M, y, { size: 24, weight: 700, maxLines: 2, lh: 1.2 });
  if (d.project.address) y = drawText(ctx, d.project.address, M, y + 2 * MM, { size: 12, color: C.ink2, maxLines: 2 });
  const price = fmtPrice(d.project.price);
  if (price) y = drawText(ctx, price, M, y + 9 * MM, { size: 26, weight: 700, color: C.accent });

  const f = facts(d);
  if (f.length) {
    y += 8 * MM;
    const gap = 3 * MM;
    const bw = (CW - gap * (f.length - 1)) / f.length;
    f.forEach(([label, value], i) => {
      const x = M + i * (bw + gap);
      ctx.fillStyle = C.paper;
      ctx.fillRect(x, y, bw, 22 * MM);
      drawText(ctx, label, x + 4 * MM, y + 8 * MM, { size: 9, color: C.ink2, maxW: bw - 8 * MM, maxLines: 1 });
      drawText(ctx, value, x + 4 * MM, y + 17 * MM, { size: f.length > 4 ? 13 : 15, weight: 700, maxW: bw - 8 * MM, maxLines: 1 });
    });
  }

  agentBlock(ctx, d, H - M - 30 * MM);
  return canvas;
}

function pagePlan(d) {
  const { canvas, ctx } = newPage();
  header(ctx, 'Планировка');
  const top = M + 22 * MM;
  const rooms = d.project.plan.rooms;
  const twoCols = rooms.length > 6;
  const rowH = 7 * MM;
  const tableRows = (twoCols ? Math.ceil(rooms.length / 2) : rooms.length) + 1;
  const tableH = tableRows * rowH + 30 * MM;
  const planH = H - top - tableH - 22 * MM;
  drawContain(ctx, d.plan, M, top, CW, planH);

  let y = top + planH + 10 * MM;
  const colW = twoCols ? (CW - 10 * MM) / 2 : CW;
  rooms.forEach((r, i) => {
    const col = twoCols && i >= Math.ceil(rooms.length / 2) ? 1 : 0;
    const row = col ? i - Math.ceil(rooms.length / 2) : i;
    const x = M + col * (colW + 10 * MM), ry = y + row * rowH;
    const t = ROOM_TYPES[r.type] || ROOM_TYPES.room;
    ctx.fillStyle = t.fill;
    ctx.fillRect(x, ry - 3.6 * MM, 3.5 * MM, 3.5 * MM);
    drawText(ctx, r.name || t.short, x + 6 * MM, ry, { size: 11, maxW: colW - 30 * MM, maxLines: 1 });
    drawText(ctx, `${fmtArea(roomArea(r))} м²`, x + colW, ry, { size: 11, align: 'right' });
    ctx.fillStyle = C.line;
    ctx.fillRect(x, ry + 2.2 * MM, colW, 1);
  });

  y += (twoCols ? Math.ceil(rooms.length / 2) : rooms.length) * rowH + 6 * MM;
  const s = d.summary;
  const totals = [['Общая площадь', s.total], ['Жилая', s.living], ['Кухня', s.kitchen], ['Балконы и лоджии', s.outdoor]]
    .filter(([, v]) => v);
  const tw = CW / Math.max(1, totals.length);
  totals.forEach(([label, v], i) => {
    drawText(ctx, label, M + i * tw, y, { size: 9, color: C.ink2 });
    drawText(ctx, `${fmtArea(v)} м²`, M + i * tw, y + 6.5 * MM, { size: 14, weight: 700 });
  });
  drawText(ctx, 'Площади указаны по внутреннему контуру помещений.', M, y + 16 * MM, { size: 8.5, color: C.ink2 });
  return canvas;
}

function pagePhotos(d, pair) {
  const { canvas, ctx } = newPage();
  header(ctx, 'Фотографии');
  const top = M + 22 * MM, gap = 8 * MM;
  const boxH = (H - top - 24 * MM - gap) / 2;
  pair.forEach((img, i) => {
    const y = top + i * (boxH + gap);
    ctx.fillStyle = C.paper;
    ctx.fillRect(M, y, CW, boxH);
    drawContain(ctx, img, M, y, CW, boxH);
  });
  return canvas;
}

function pageAbout(d) {
  const { canvas, ctx } = newPage();
  header(ctx, 'Об объекте');
  let y = M + 32 * MM;
  y = drawText(ctx, d.project.description, M, y, { size: 12, lh: 1.55, maxLines: 40 });
  agentBlock(ctx, d, Math.max(y + 12 * MM, H - M - 40 * MM));
  return canvas;
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
      if (e?.name !== 'AbortError') toast('Не получилось собрать PDF');
    } finally { busy = false; progress(''); }
  }

  $('#download').onclick = () => guarded(async () => {
    downloadBlob(await buildPdf(), `${safeName(project.name)}.pdf`);
  });
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
