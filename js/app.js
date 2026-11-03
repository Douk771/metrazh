import {
  listProjects, getProject, saveProject, deleteProject, newProject, countPhotos,
  exportProject, importProject, requestPersistence, isPersisted,
} from './db.js';
import { openEditor, planThumbnail } from './editor.js';
import { openPhotos } from './photos.js';
import { openPresentation } from './presentation.js';
import { openListing } from './listing.js';
import { renderHelp } from './help.js';
import { renderCard } from './card.js';
import { summarize, fmtArea } from './geometry.js';
import { esc } from './ui.js';
import { demoProject } from './demo.js';

const app = document.getElementById('app');
let closeScreen = null;
let cameFromApp = false;   // для кнопки «Назад» в справке

export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

async function renderList() {
  const projects = await listProjects();
  const counts = await Promise.all(projects.map((p) => countPhotos(p.id)));
  const persisted = await isPersisted();
  const showInstall = isIos() && !isStandalone();

  app.innerHTML = `
    <main class="list-screen">
      <div class="brand"><h1>Метраж</h1>
        <a class="btn ghost help-btn" href="#/help" title="Как это работает" aria-label="Как это работает">?</a>
        <a class="btn ghost menu-btn" href="#/card" title="Моя визитка" aria-label="Моя визитка">☰</a></div>
      <p class="tagline">Планировки, фото и презентации объектов — прямо на телефоне.</p>
      ${showInstall ? `<div class="notice"><b>Добавьте на экран «Домой»</b>
        Нажмите «Поделиться» → «На экран Домой». Так приложение работает без интернета, а Safari не удалит ваши объекты.</div>` : ''}
      ${!persisted && !showInstall ? `<div class="notice"><b>Объекты хранятся только на этом устройстве</b>
        Браузер может удалить их при нехватке места или очистке данных. Чтобы не потерять работу, нажмите «Копия» на карточке
        и сохраните файл в облако или отправьте себе. <a href="#/help/backup">Подробнее</a></div>` : ''}
      <div class="actions">
        <label class="btn">Загрузить копию<input type="file" id="import" accept=".json,application/json" hidden></label>
        <button class="btn" id="demo">Открыть пример</button>
        <a class="btn" href="#/card">Моя визитка</a>
      </div>
      <div class="new-wrap"><button class="btn new-object" id="new">+ Новый объект</button></div>
      ${projects.length ? `<div class="cards">${projects.map((p, i) => card(p, counts[i])).join('')}</div>`
        : `<div class="empty">Пока нет объектов. Создайте первый или откройте пример, чтобы посмотреть, как всё выглядит.</div>`}
    </main>`;

  app.querySelector('#new').onclick = async () => {
    const name = prompt('Адрес или название объекта', '');
    if (name === null) return;
    const p = newProject(name.trim() || undefined);
    await saveProject(p);
    requestPersistence();
    location.hash = `#/p/${p.id}/photos`;
  };
  app.querySelector('#demo').onclick = async () => {
    const p = demoProject();
    await saveProject(p);
    location.hash = `#/p/${p.id}`;
  };
  app.querySelector('#import').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const p = await importProject(file);
      toast(`Загружено: ${p.name}`);
      renderList();
    } catch (err) {
      toast(err.message || 'Не удалось прочитать файл');
    }
  };
  app.querySelectorAll('[data-open]').forEach((b) => { b.onclick = () => { location.hash = `#/p/${b.dataset.open}`; }; });
  app.querySelectorAll('[data-export]').forEach((b) => {
    b.onclick = async () => {
      b.disabled = true;
      try { await exportProject(projects.find((p) => p.id === b.dataset.export)); } finally { b.disabled = false; }
    };
  });
  app.querySelectorAll('[data-delete]').forEach((b) => {
    b.onclick = async () => {
      const p = projects.find((x) => x.id === b.dataset.delete);
      if (!confirm(`Удалить «${p.name}» вместе с фото? Это нельзя отменить.`)) return;
      await deleteProject(p.id);
      renderList();
    };
  });
}

function card(p, photoCount) {
  const s = summarize(p.plan.rooms);
  const parts = [];
  if (p.plan.rooms.length) parts.push(`${s.livingCount ? `${s.livingCount}-комн., ` : ''}${fmtArea(s.total)} м²`);
  if (photoCount) parts.push(`${photoCount} фото`);
  if (!parts.length) parts.push('Пустой объект');
  parts.push(new Date(p.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }));
  return `
    <article class="card">
      <button class="card-open" data-open="${p.id}" aria-label="Открыть ${esc(p.name)}">
        ${planThumbnail(p.plan)}
        <div class="card-body">
          <p class="card-title">${esc(p.name)}</p>
          <div class="card-meta">${parts.join(' · ')}</div>
        </div>
      </button>
      <div class="card-foot">
        <a class="btn ghost" href="#/p/${p.id}/photos">Фото</a>
        <a class="btn ghost" href="#/p/${p.id}/pdf">Презентация</a>
        <button class="btn ghost" data-export="${p.id}">Копия</button>
        <button class="btn ghost danger" data-delete="${p.id}">Удалить</button>
      </div>
    </article>`;
}

async function renderProject(id, tab) {
  const project = await getProject(id);
  if (!project) { location.hash = '#/'; return; }
  const opts = { onSave: (p) => saveProject(p), toast };
  const open = { photos: openPhotos, pdf: openPresentation, listing: openListing }[tab] || openEditor;
  closeScreen = open(app, project, opts);
}

async function route() {
  if (closeScreen) { await closeScreen(); closeScreen = null; }
  const hash = location.hash;
  let m;
  if ((m = hash.match(/^#\/p\/([^/]+)(?:\/(photos|pdf|listing))?$/))) {
    renderProject(decodeURIComponent(m[1]), m[2]);
  } else if (hash === '#/card') {
    renderCard(app, { toast });
  } else if ((m = hash.match(/^#\/help(?:\/(\w+))?$/))) {
    renderHelp(app, m[1]);
    const back = app.querySelector('.help-screen > a');
    if (cameFromApp) back.onclick = (e) => { e.preventDefault(); history.back(); };
    back.textContent = cameFromApp ? '← Назад' : '← Объекты';
  } else {
    renderList();
  }
  cameFromApp = true;
}

window.addEventListener('hashchange', route);
route();

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
