// Общие кусочки интерфейса для экранов объекта.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Верхняя панель объекта: назад, название, вкладки «План / Фото», справка.
export function topbar(project, active, extra = '') {
  const id = encodeURIComponent(project.id);
  const help = active;
  return `
    <header class="topbar">
      <a class="btn ghost" href="#/" aria-label="К списку объектов">← <span class="btn-label">Объекты</span></a>
      <input class="name" id="name" value="${esc(project.name)}" aria-label="Название объекта">
      <nav class="tabs" aria-label="Разделы объекта">
        <a href="#/p/${id}" ${active === 'plan' ? 'aria-current="page"' : ''}>План</a>
        <a href="#/p/${id}/photos" ${active === 'photos' ? 'aria-current="page"' : ''}>Фото</a>
        <a href="#/p/${id}/listing" ${active === 'listing' ? 'aria-current="page"' : ''}>Текст</a>
        <a href="#/p/${id}/pdf" ${active === 'pdf' ? 'aria-current="page"' : ''}>PDF</a>
      </nav>
      <a class="btn ghost help-btn" href="#/help/${help}" title="Как это работает" aria-label="Как это работает">?</a>
      ${extra}
    </header>`;
}

export function bindTopbar(root, project, save) {
  root.querySelector('#name').onchange = (e) => {
    project.name = e.target.value.trim() || 'Без названия';
    e.target.value = project.name;
    save();
  };
}
