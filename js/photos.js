// Экран «Фото»: загрузка, порядок, водяной знак, выгрузка пакетом.
import {
  uid, listPhotos, putPhoto, putPhotos, deletePhoto, getSetting, setSetting,
  downloadBlob, safeName, requestPersistence,
} from './db.js';
import { DEFAULT_MARK, PHOTO_MAX, THUMB_MAX, loadBitmap, renderPhoto, drawWatermark, prepareLogo } from './watermark.js';
import { makeZip } from './zip.js';
import { topbar, bindTopbar, esc } from './ui.js';

const POSITIONS = [
  ['tl', 'Слева сверху'], [null], ['tr', 'Справа сверху'],
  [null], ['center', 'По центру'], [null],
  ['bl', 'Слева снизу'], [null], ['br', 'Справа снизу'],
];

const canShareFiles = (() => {
  try {
    return !!navigator.canShare?.({ files: [new File([''], 'a.jpg', { type: 'image/jpeg' })] });
  } catch { return false; }
})();

export function openPhotos(root, project, { onSave, toast }) {
  let photos = [];
  let mark = { ...DEFAULT_MARK };
  let logo = null;            // ImageBitmap логотипа
  let logoUrl = null;
  let busy = false;
  let closed = false;
  let loaded = false;
  const thumbs = new Map();   // id → ImageBitmap превью
  let sample = null;          // заглушка для превью, пока фото нет
  let markTimer = null;

  root.innerHTML = `
    <div class="project-screen">
      ${topbar(project, 'photos')}
      <main class="photos-main">
        <section class="photos-col">
          <div class="photo-actions">
            <label class="btn primary">+ Добавить фото<input type="file" id="add" accept="image/*" multiple hidden></label>
            <span class="muted" id="count"></span>
          </div>
          <div class="photo-actions" id="exports" hidden>
            <button class="btn" id="dl-mark">Скачать с водяным знаком</button>
            <button class="btn" id="dl-clean">Скачать без знака</button>
            ${canShareFiles ? '<button class="btn" id="share">Поделиться…</button>' : ''}
          </div>
          <div class="progress" id="progress" hidden></div>
          <div class="photo-grid" id="grid"></div>
        </section>
        <aside class="mark-card" id="mark"></aside>
      </main>
    </div>`;

  const $ = (s) => root.querySelector(s);
  bindTopbar(root, project, () => onSave(project));

  // ---------- сетка фото ----------
  function progress(text) {
    const el = $('#progress');
    if (!el) return;
    el.hidden = !text;
    el.textContent = text || '';
  }

  function renderGrid() {
    $('#count').textContent = photos.length ? `${photos.length} фото` : '';
    $('#exports').hidden = !photos.length;
    const grid = $('#grid');
    if (!photos.length) {
      grid.innerHTML = `<div class="empty">Добавьте фото объекта — с телефона или с компьютера.
        Первое фото станет обложкой. Оригиналы остаются только на этом устройстве.</div>`;
      return;
    }
    grid.innerHTML = photos.map((p, i) => `
      <figure class="photo" data-id="${p.id}">
        <canvas width="${Math.round(p.w * Math.min(1, THUMB_MAX / Math.max(p.w, p.h)))}"
                height="${Math.round(p.h * Math.min(1, THUMB_MAX / Math.max(p.w, p.h)))}"></canvas>
        <figcaption>
          <span class="num">${i + 1}${i === 0 ? ' · обложка' : ''}</span>
          <span class="photo-btns">
            <button class="btn ghost" data-move="-1" ${i === 0 ? 'disabled' : ''} aria-label="Раньше">←</button>
            <button class="btn ghost" data-move="1" ${i === photos.length - 1 ? 'disabled' : ''} aria-label="Позже">→</button>
            <button class="btn ghost danger" data-del aria-label="Удалить фото">✕</button>
          </span>
        </figcaption>
      </figure>`).join('');
    grid.querySelectorAll('.photo').forEach((el) => {
      const id = el.dataset.id;
      el.querySelectorAll('[data-move]').forEach((b) => { b.onclick = () => move(id, Number(b.dataset.move)); });
      el.querySelector('[data-del]').onclick = () => remove(id);
    });
    drawPreviews();
  }

  async function thumbOf(p) {
    if (!thumbs.has(p.id)) thumbs.set(p.id, await loadBitmap(p.thumb));
    return thumbs.get(p.id);
  }

  async function drawPreviews() {
    for (const el of root.querySelectorAll('.photo')) {
      const p = photos.find((x) => x.id === el.dataset.id);
      if (!p) continue;
      const bmp = await thumbOf(p);
      if (closed) return;
      const c = el.querySelector('canvas');
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, c.width, c.height);
      drawWatermark(ctx, c.width, c.height, mark, logo);
    }
    drawMarkPreview();
  }

  async function addFiles(files) {
    if (!files.length || busy) return;
    busy = true;
    let order = photos.length ? photos[photos.length - 1].order + 1 : 0;
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      progress(`Обработка ${i + 1} из ${files.length}…`);
      try {
        const bmp = await loadBitmap(files[i]);
        const full = await renderPhoto(bmp, { maxSide: PHOTO_MAX, quality: 0.9 });
        const thumb = await renderPhoto(bmp, { maxSide: THUMB_MAX, quality: 0.8 });
        bmp.close?.();
        const photo = {
          id: uid(), projectId: project.id, order: order++, name: files[i].name,
          blob: full.blob, thumb: thumb.blob, w: full.w, h: full.h, createdAt: Date.now(),
        };
        await putPhoto(photo);
        photos.push(photo);
      } catch {
        failed++;
      }
    }
    progress('');
    busy = false;
    requestPersistence();
    onSave(project);
    renderGrid();
    if (failed) toast(`Не удалось открыть ${failed} файл(ов). Подойдут JPEG, PNG, HEIC с iPhone.`);
  }

  async function move(id, dir) {
    const i = photos.findIndex((p) => p.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= photos.length) return;
    [photos[i].order, photos[j].order] = [photos[j].order, photos[i].order];
    [photos[i], photos[j]] = [photos[j], photos[i]];
    await putPhotos([photos[i], photos[j]]);
    renderGrid();
  }

  async function remove(id) {
    if (!confirm('Удалить это фото из объекта?')) return;
    await deletePhoto(id);
    thumbs.get(id)?.close?.();
    thumbs.delete(id);
    photos = photos.filter((p) => p.id !== id);
    onSave(project);
    renderGrid();
  }

  // ---------- выгрузка ----------
  async function buildFiles(withMark) {
    const files = [];
    for (let i = 0; i < photos.length; i++) {
      progress(`Готовлю фото ${i + 1} из ${photos.length}…`);
      const blob = withMark
        ? (await renderPhoto(photos[i].blob, { maxSide: PHOTO_MAX, quality: 0.9, mark, logo })).blob
        : photos[i].blob;
      files.push({ name: `${String(i + 1).padStart(2, '0')}.jpg`, blob });
    }
    progress('');
    return files;
  }

  async function exportZip(withMark) {
    if (busy) return;
    if (withMark && !hasMark()) { toast('Сначала добавьте логотип или подпись справа'); return; }
    busy = true;
    try {
      const files = await buildFiles(withMark);
      progress('Собираю архив…');
      const zip = await makeZip(files);
      downloadBlob(zip, `${safeName(project.name)} — фото${withMark ? '' : ' без знака'}.zip`);
    } catch (e) {
      toast('Не получилось подготовить архив');
    } finally {
      progress('');
      busy = false;
    }
  }

  async function share() {
    if (busy) return;
    busy = true;
    try {
      const files = (await buildFiles(hasMark()))
        .map((f) => new File([f.blob], `${safeName(project.name)} ${f.name}`, { type: 'image/jpeg' }));
      await navigator.share({ files, title: project.name });
    } catch (e) {
      if (e?.name !== 'AbortError') toast('Не удалось поделиться — скачайте архивом');
    } finally {
      progress('');
      busy = false;
    }
  }

  const hasMark = () => mark.enabled && (logo || mark.text.trim());

  // ---------- настройки знака ----------
  function renderMarkCard() {
    $('#mark').innerHTML = `
      <h2>Водяной знак</h2>
      <canvas id="m-preview" class="mark-preview" width="960" height="640" aria-label="Пример фото со знаком"></canvas>
      <label class="check"><input type="checkbox" id="m-on" ${mark.enabled ? 'checked' : ''}> Наносить знак при выгрузке</label>
      <div class="field"><span>Логотип</span>
        <div class="logo-row">
          <div class="logo-box">${logoUrl ? `<img src="${logoUrl}" alt="Логотип">` : '<span class="muted">нет</span>'}</div>
          <label class="btn">${logoUrl ? 'Заменить' : 'Загрузить'}<input type="file" id="m-logo" accept="image/*" hidden></label>
          ${logoUrl ? '<button class="btn ghost danger" id="m-logo-del">Убрать</button>' : ''}
        </div>
      </div>
      <label class="field">Подпись
        <input id="m-text" value="${esc(mark.text)}" maxlength="80" placeholder="Имя, телефон, агентство">
      </label>
      <div class="field"><span>Где разместить</span>
        <div class="pos" role="radiogroup" aria-label="Положение знака">
          ${POSITIONS.map(([k, label]) => (k
            ? `<button type="button" role="radio" data-pos="${k}" aria-checked="${mark.position === k}" aria-label="${label}" title="${label}"></button>`
            : '<span></span>')).join('')}
        </div>
      </div>
      <label class="field">Размер логотипа <input type="range" id="m-size" min="6" max="45" value="${mark.size}"></label>
      <label class="field">Непрозрачность <input type="range" id="m-op" min="15" max="100" value="${mark.opacity}"></label>
      <p class="muted">Знак общий для всех объектов. Оригиналы фото не меняются: знак наносится только на выгружаемые копии.
        <a href="#/help/photos">Как это работает</a></p>`;

    const update = (fn, rerenderCard = false) => {
      fn();
      clearTimeout(markTimer);
      markTimer = setTimeout(() => setSetting('mark', mark), 300);
      if (rerenderCard) renderMarkCard();
      drawPreviews();
    };
    $('#m-on').onchange = (e) => update(() => { mark.enabled = e.target.checked; });
    $('#m-text').oninput = (e) => update(() => { mark.text = e.target.value; });
    $('#m-size').oninput = (e) => update(() => { mark.size = Number(e.target.value); });
    $('#m-op').oninput = (e) => update(() => { mark.opacity = Number(e.target.value); });
    root.querySelectorAll('[data-pos]').forEach((b) => {
      b.onclick = () => update(() => { mark.position = b.dataset.pos; }, true);
    });
    $('#m-logo').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const blob = await prepareLogo(file);
        await setLogo(blob);
        update(() => { mark.logo = blob; }, true);
      } catch {
        toast('Не удалось открыть логотип');
      }
    };
    const del = $('#m-logo-del');
    if (del) del.onclick = async () => { await setLogo(null); update(() => { mark.logo = null; }, true); };
    drawMarkPreview();
  }

  async function setLogo(blob) {
    logo?.close?.();
    if (logoUrl) URL.revokeObjectURL(logoUrl);
    logo = blob ? await loadBitmap(blob) : null;
    logoUrl = blob ? URL.createObjectURL(blob) : null;
  }

  function sampleImage() {
    if (sample) return sample;
    const c = document.createElement('canvas');
    c.width = 960; c.height = 640;
    const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 640);
    sky.addColorStop(0, '#d9d2c3'); sky.addColorStop(1, '#b9ab93');
    g.fillStyle = sky; g.fillRect(0, 0, 960, 640);
    g.fillStyle = '#f2ede2'; g.fillRect(560, 90, 260, 300);           // окно
    g.strokeStyle = '#8c7f6a'; g.lineWidth = 10; g.strokeRect(560, 90, 260, 300);
    g.beginPath(); g.moveTo(690, 90); g.lineTo(690, 390); g.stroke();
    g.fillStyle = '#7c6a55'; g.fillRect(0, 470, 960, 170);            // пол
    g.fillStyle = '#5d6b66'; g.fillRect(90, 330, 360, 170);           // диван
    g.fillStyle = '#4b5853'; g.fillRect(90, 300, 360, 50);
    sample = c;
    return c;
  }

  async function drawMarkPreview() {
    const c = $('#m-preview');
    if (!c) return;
    const src = photos.length ? await thumbOf(photos[0]) : sampleImage();
    if (closed) return;
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    drawWatermark(ctx, c.width, c.height, mark, logo);
  }

  // ---------- старт ----------
  $('#add').onchange = (e) => { addFiles([...e.target.files]); e.target.value = ''; };
  $('#dl-mark').onclick = () => exportZip(true);
  $('#dl-clean').onclick = () => exportZip(false);
  if (canShareFiles) $('#share').onclick = share;

  (async () => {
    const saved = await getSetting('mark', null);
    if (saved) mark = { ...DEFAULT_MARK, ...saved };
    if (mark.logo) await setLogo(mark.logo);
    photos = await listPhotos(project.id);
    if (closed) return;
    loaded = true;
    renderMarkCard();
    renderGrid();
  })();

  return async function close() {
    closed = true;
    clearTimeout(markTimer);
    if (loaded) await setSetting('mark', mark);
    thumbs.forEach((b) => b.close?.());
    logo?.close?.();
    if (logoUrl) URL.revokeObjectURL(logoUrl);
  };
}
