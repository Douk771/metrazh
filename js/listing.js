// Вкладка «Текст»: заголовок и описание для объявления, собранные из планировки и данных объекта.
import { summarize, fmtArea, roomArea } from './geometry.js';
import { topbar, bindTopbar, esc } from './ui.js';

function plural(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

const NUM_WORDS = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть'];
const list = (arr) => (arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} и ${arr[arr.length - 1]}`);
const int = (s) => { const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10); return Number.isFinite(n) && n > 0 ? n : null; };

// Факты об объекте из планировки — общая основа для заголовка и описания.
export function listingFacts(project) {
  const rooms = project.plan.rooms;
  const s = summarize(rooms);
  const count = (...types) => rooms.filter((r) => types.includes(r.type)).length;
  const living = rooms.filter((r) => r.type === 'room').map(roomArea).sort((a, b) => b - a);
  return {
    s,
    living,
    studio: s.livingCount === 1 && !count('kitchen'),
    baths: count('bath'), wcs: count('wc'), combos: count('combo'),
    balconies: count('balcony'), loggias: count('loggia'), storages: count('storage'),
    floor: int(project.floor), floors: int(project.floors),
    windows: (project.plan.openings || []).filter((o) => o.type === 'window').length,
  };
}

export function listingTitle(project) {
  const f = listingFacts(project);
  const parts = [];
  if (f.studio) parts.push('Квартира-студия');
  else if (f.s.livingCount) parts.push(`${f.s.livingCount}-к. квартира`);
  else parts.push('Квартира');
  if (f.s.total) parts.push(`${fmtArea(f.s.total)} м²`);
  if (f.floor) parts.push(f.floors ? `${f.floor}/${f.floors} эт.` : `${f.floor} эт.`);
  return parts.join(', ');
}

export function listingBody(project) {
  const f = listingFacts(project);
  const lines = [];
  if (!project.plan.rooms.length) return (project.description || '').trim();

  // Первое предложение: что это и где по этажу.
  let first;
  if (f.studio) first = 'Квартира-студия';
  else if (f.s.livingCount) first = `${f.s.livingCount}-комнатная квартира`;
  else first = 'Квартира';
  if (f.s.total) first += ` общей площадью ${fmtArea(f.s.total)} м²`;
  if (f.floor) {
    first += ` на ${f.floor} этаже`;
    if (f.floors) first += ` ${f.floors}-этажного дома`;
  }
  lines.push(`${first}.`);

  // Комнаты и кухня.
  const rooms = [];
  if (f.living.length && !f.studio) {
    const areas = list(f.living.map((a) => fmtArea(a)));
    rooms.push(f.living.length === 1
      ? `Жилая комната ${areas} м²`
      : `${NUM_WORDS[f.living.length] ? NUM_WORDS[f.living.length][0].toUpperCase() + NUM_WORDS[f.living.length].slice(1) : f.living.length} ${plural(f.living.length, 'комната', 'комнаты', 'комнат')}: ${areas} м²`);
  }
  if (f.s.living && f.living.length > 1) rooms.push(`жилая площадь ${fmtArea(f.s.living)} м²`);
  if (f.s.kitchen) rooms.push(`кухня ${fmtArea(f.s.kitchen)} м²`);
  if (rooms.length) lines.push(`${rooms.join(', ')}.`);

  // Санузел, балконы, кладовые.
  const extra = [];
  if (f.combos && !f.baths && !f.wcs) extra.push(f.combos > 1 ? `${f.combos} совмещённых санузла` : 'санузел совмещённый');
  else if (f.baths || f.wcs) {
    const n = f.baths + f.wcs + f.combos;
    extra.push(f.baths && f.wcs && n === 2 ? 'санузел раздельный' : `${n} ${plural(n, 'санузел', 'санузла', 'санузлов')}`);
  }
  if (f.balconies) extra.push(f.balconies > 1 ? `${f.balconies} балкона` : 'балкон');
  if (f.loggias) extra.push(f.loggias > 1 ? `${f.loggias} лоджии` : 'лоджия');
  if (f.s.outdoor && (f.balconies + f.loggias) === 1) extra[extra.length - 1] += ` ${fmtArea(f.s.outdoor)} м²`;
  if (f.storages) extra.push(f.storages > 1 ? 'кладовые' : 'кладовая');
  if (extra.length) {
    const t = extra.join(', ');
    lines.push(`${t[0].toUpperCase()}${t.slice(1)}.`);
  }

  const desc = (project.description || '').trim();
  return [lines.join(' '), desc].filter(Boolean).join('\n\n');
}

export function openListing(root, project, { onSave, toast }) {
  root.innerHTML = `
    <div class="project-screen">
      ${topbar(project, 'listing')}
      <main class="listing-main">
        ${!project.plan.rooms.length ? `<div class="notice"><b>Сначала нарисуйте планировку</b>
          Текст собирается из комнат и площадей во вкладке «План».</div>` : ''}
        <section class="listing-card">
          <div class="listing-head"><h2>Заголовок</h2><button class="btn" data-copy="l-title">Скопировать</button></div>
          <input id="l-title" class="listing-title">
        </section>
        <section class="listing-card">
          <div class="listing-head"><h2>Описание</h2><button class="btn primary" data-copy="l-body">Скопировать</button></div>
          <textarea id="l-body" rows="10"></textarea>
          <div class="listing-foot">
            <span class="muted" id="l-count"></span>
            <button class="btn ghost" id="l-reset" hidden>Собрать заново</button>
          </div>
        </section>
        <section class="listing-card">
          <h2>Ваш текст об объекте</h2>
          <p class="muted">Добавится в конец описания. Тот же текст попадает в PDF-презентацию.</p>
          <textarea id="l-desc" rows="5" placeholder="Ремонт, вид из окон, двор, транспорт, документы…">${esc(project.description || '')}</textarea>
          <div class="row">
            <label class="field">Этаж<input id="l-floor" inputmode="numeric" value="${esc(project.floor || '')}"></label>
            <label class="field">Этажей в доме<input id="l-floors" inputmode="numeric" value="${esc(project.floors || '')}"></label>
          </div>
        </section>
        <p class="muted">Текст можно править прямо здесь — правки сохраняются. <a href="#/help/listing">Как это работает</a></p>
      </main>
    </div>`;

  const $ = (s) => root.querySelector(s);
  bindTopbar(root, project, () => onSave(project));
  project.listing ??= {};

  // Если риелтор правил текст руками, держим его версию, пока не нажмёт «Собрать заново».
  function fill() {
    $('#l-title').value = project.listing.title ?? listingTitle(project);
    $('#l-body').value = project.listing.body ?? listingBody(project);
    $('#l-reset').hidden = project.listing.title == null && project.listing.body == null;
    $('#l-count').textContent = `${$('#l-body').value.length} ${plural($('#l-body').value.length, 'символ', 'символа', 'символов')}`;
  }

  $('#l-title').oninput = (e) => { project.listing.title = e.target.value; onSave(project); $('#l-reset').hidden = false; };
  $('#l-body').oninput = (e) => {
    project.listing.body = e.target.value;
    onSave(project);
    $('#l-reset').hidden = false;
    $('#l-count').textContent = `${e.target.value.length} ${plural(e.target.value.length, 'символ', 'символа', 'символов')}`;
  };
  $('#l-reset').onclick = () => { delete project.listing.title; delete project.listing.body; onSave(project); fill(); };

  const bind = (id, key) => { $(id).oninput = (e) => { project[key] = e.target.value; onSave(project); fill(); }; };
  bind('#l-desc', 'description');
  bind('#l-floor', 'floor');
  bind('#l-floors', 'floors');

  root.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = async () => {
      const el = $(`#${b.dataset.copy}`);
      try {
        await navigator.clipboard.writeText(el.value);
      } catch {
        el.select();
        document.execCommand('copy');
      }
      toast('Скопировано — вставьте в объявление');
    };
  });

  fill();
  return async function close() { await onSave(project); };
}
