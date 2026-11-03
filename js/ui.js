// Общие кусочки интерфейса для экранов объекта.
import { countPhotos } from './db.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Этапы работы над объектом, в порядке прохождения.
const STEPS = [
  { key: 'photos', label: 'Фото', path: '/photos' },
  { key: 'plan', label: 'План', path: '' },
  { key: 'listing', label: 'Текст', path: '/listing' },
  { key: 'pdf', label: 'Презентация', path: '/pdf' },
];

// Шапка объекта: логотип, справка, шкала заполнения, название и цветные вкладки разделов.
export function topbar(project, active, extra = '') {
  const id = encodeURIComponent(project.id);
  const next = STEPS[STEPS.findIndex((s) => s.key === active) + 1];
  return `
    <header class="topbar" data-active="${active}">
      <a class="btn ghost back" href="#/" aria-label="К списку объектов">←</a>
      <a class="wordmark" href="#/" aria-label="Метраж, к списку объектов">Метраж</a>
      <input class="name" id="name" value="${esc(project.name)}" aria-label="Название или адрес объекта">
      <nav class="tabs" aria-label="Разделы объекта">
        ${STEPS.map((s) => `<a class="tab-${s.key}" href="#/p/${id}${s.path}" ${active === s.key ? 'aria-current="page"' : ''}>${s.label}</a>`).join('')}
      </nav>
      <a class="btn ghost help-btn" href="#/help/${active}" title="Как это работает" aria-label="Как это работает">?</a>
      ${extra}
      <div class="scale-wrap">
        <div class="scale" id="scale" role="progressbar" aria-label="Шкала заполнения проекта" aria-valuemin="0" aria-valuemax="5"><i></i></div>
        <span>Шкала заполнения проекта</span>
      </div>
    </header>
    ${next ? `<a class="next-step" href="#/p/${id}${next.path}" title="Дальше: ${next.label}" aria-label="Дальше: ${next.label}">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6"/></svg>
    </a>` : ''}`;
}

// Шкала: название, фото, план, просмотренный текст, просмотренная презентация. Каждый этап — равная доля.
export async function refreshScale(root, project) {
  const el = root.querySelector('#scale');
  if (!el) return;
  const photos = await countPhotos(project.id);
  const done = [
    project.name && project.name !== 'Новый объект',
    photos > 0,
    project.plan.rooms.length > 0,
    project.visited?.listing,
    project.visited?.pdf,
  ].filter(Boolean).length;
  el.setAttribute('aria-valuenow', done);
  el.firstElementChild.style.width = `${done * 20}%`;
}

export function bindTopbar(root, project, save) {
  const active = root.querySelector('.topbar').dataset.active;
  if ((active === 'listing' || active === 'pdf') && !project.visited?.[active]) {
    project.visited = { ...project.visited, [active]: true };
    save();
  }
  root.querySelector('#name').onchange = (e) => {
    project.name = e.target.value.trim() || 'Без названия';
    e.target.value = project.name;
    save();
    refreshScale(root, project);
  };
  refreshScale(root, project);
}
