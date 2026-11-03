// Экран «Моя визитка»: контакты агента, QR-код и готовая картинка, чтобы поделиться.
// При сканировании QR-кода телефон предлагает сохранить новый контакт.
import { getSetting, setSetting, downloadBlob, safeName } from './db.js';
import { canvasToBlob } from './watermark.js';
import { makeQr, drawQr } from './qr.js';
import { canShareImages, createImageShare, imageFile } from './share.js';
import { esc } from './ui.js';

const FIELDS = [
  ['firstName', 'Имя', 'text', 'given-name'],
  ['middleName', 'Отчество', 'text', 'additional-name'],
  ['lastName', 'Фамилия', 'text', 'family-name'],
  ['phone', 'Телефон', 'tel', 'tel'],
  ['email', 'Почта', 'email', 'email'],
  ['agency', 'Агентство', 'text', 'organization'],
  ['telegram', 'Telegram', 'text', 'off'],
  ['vk', 'ВКонтакте', 'text', 'off'],
  ['site', 'Сайт', 'url', 'url'],
];

const W = 1080, H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif';

const fullName = (a) => [a.firstName, a.middleName, a.lastName].filter(Boolean).join(' ');

// Раньше агент вводил одно поле «Имя» в презентации: раскладываем его на части.
function splitName(agent) {
  if (agent.firstName || agent.lastName || !agent.name) return agent;
  const words = agent.name.trim().split(/\s+/);
  return {
    ...agent,
    firstName: words[0],
    lastName: words.length > 1 ? words[words.length - 1] : '',
    middleName: words.slice(1, -1).join(' '),
  };
}

const vcfText = (s) => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');

function socialUrl(value, base) {
  const v = (value || '').trim();
  if (!v) return '';
  if (/^https?:\/\//i.test(v)) return v;
  if (/^(t\.me|vk\.com)\//i.test(v)) return `https://${v}`;
  return `${base}${v.replace(/^@/, '')}`;
}

// Контакт в формате vCard 3.0: его понимают камеры iPhone и Android.
export function buildVCard(a) {
  const name = fullName(a);
  if (!name && !a.phone && !a.email) return '';
  const site = (a.site || '').trim();
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `N:${[a.lastName, a.firstName, a.middleName, '', ''].map((v) => vcfText(v || '')).join(';')}`,
    `FN:${vcfText(name || a.agency || a.phone || a.email)}`,
  ];
  if (a.agency) lines.push(`ORG:${vcfText(a.agency)}`);
  if (a.phone) lines.push(`TEL;TYPE=CELL:${vcfText(a.phone.replace(/[\s()-]/g, ''))}`);
  if (a.email) lines.push(`EMAIL:${vcfText(a.email)}`);
  for (const url of [socialUrl(a.telegram, 'https://t.me/'), socialUrl(a.vk, 'https://vk.com/'),
    site && (/^https?:\/\//i.test(site) ? site : `https://${site}`)]) {
    if (url) lines.push(`URL:${vcfText(url)}`);
  }
  lines.push('END:VCARD');
  return `${lines.join('\r\n')}\r\n`;
}

function fitText(ctx, text, maxW, size, weight) {
  let s = size;
  do {
    ctx.font = `${weight} ${s}px ${FONT}`;
    if (ctx.measureText(text).width <= maxW) break;
    s -= 2;
  } while (s > 24);
  return s;
}

// Картинка-визитка: имя, контакты и QR-код на фирменном фоне.
export function drawCard(canvas, agent, vcard) {
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#4b635f');
  g.addColorStop(0.5, '#a39f8f');
  g.addColorStop(1, '#e3ccb9');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';

  const name = fullName(agent) || 'Ваше имя';
  ctx.fillStyle = '#ffffff';
  fitText(ctx, name, W - 120, 68, 800);
  ctx.fillText(name, W / 2, 130);
  let y = 190;
  if (agent.agency) {
    fitText(ctx, agent.agency, W - 120, 40, 500);
    ctx.fillText(agent.agency, W / 2, y);
    y += 20;
  }

  const side = 760, x = (W - side) / 2, top = y + 30;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(x + 32, top);
  ctx.arcTo(x + side, top, x + side, top + side, 32);
  ctx.arcTo(x + side, top + side, x, top + side, 32);
  ctx.arcTo(x, top + side, x, top, 32);
  ctx.arcTo(x, top, x + side, top, 32);
  ctx.closePath();
  ctx.fill();
  if (vcard) drawQr(ctx, makeQr(vcard), x + 20, top + 20, side - 40);

  ctx.fillStyle = '#1f2b29';
  let ty = top + side + 76;
  if (agent.phone) {
    fitText(ctx, agent.phone, W - 120, 56, 700);
    ctx.fillText(agent.phone, W / 2, ty);
    ty += 56;
  }
  if (agent.email) {
    fitText(ctx, agent.email, W - 120, 38, 500);
    ctx.fillText(agent.email, W / 2, ty);
    ty += 50;
  }
  ctx.font = `400 30px ${FONT}`;
  ctx.fillText('Наведите камеру телефона, чтобы сохранить контакт', W / 2, H - 44);
}

export async function renderCard(root, { toast }) {
  const saved = await getSetting('agent', {});
  const agent = splitName({ ...saved });

  root.innerHTML = `
    <main class="list-screen card-screen">
      <div class="brand">
        <a class="btn ghost back-link" href="#/" aria-label="К списку объектов">←</a>
        <h1>Метраж</h1>
        <a class="btn ghost help-btn" href="#/help/card" title="Как это работает" aria-label="Как это работает">?</a>
      </div>
      <div class="card-grid">
        <section class="listing-card">
          <h2>Моя визитка</h2>
          <p class="muted">Заполните один раз. Телефон и агентство подставятся и в презентации.</p>
          ${FIELDS.map(([key, label, type, auto]) => `<label class="field">${label}
            <input data-key="${key}" type="${type}" autocomplete="${auto}" value="${esc(agent[key] || '')}"></label>`).join('')}
        </section>
        <section class="card-preview">
          <canvas id="card" aria-label="Визитка с QR-кодом"></canvas>
          <p class="card-empty" id="card-empty" hidden>Впишите имя, телефон или почту, и появится QR-код.</p>
          <div class="pdf-actions" id="card-actions">
            ${canShareImages() ? '<button class="btn primary" id="card-share">Поделиться визиткой</button>' : ''}
            <button class="btn" id="card-image">Скачать картинку</button>
            <button class="btn" id="card-vcf">Скачать контакт</button>
          </div>
        </section>
      </div>
    </main>`;

  const $ = (s) => root.querySelector(s);
  const canvas = $('#card');
  const fileBase = () => `Визитка ${safeName(fullName(agent) || 'агента')}`;
  const cardBlob = () => canvasToBlob(canvas, 'image/jpeg', 0.95);
  const downloadImage = async () => downloadBlob(await cardBlob(), `${fileBase()}.jpg`);

  const shareBtn = $('#card-share');
  const share = shareBtn && createImageShare({
    button: shareBtn,
    title: fullName(agent) || 'Визитка',
    build: async () => [imageFile(`${fileBase()}.jpg`, await cardBlob())],
    toast,
  });

  function redraw() {
    const vcard = buildVCard(agent);
    try {
      drawCard(canvas, agent, vcard);
    } catch (e) {
      toast(e.message || 'Не удалось создать QR-код');
    }
    $('#card-empty').hidden = !!vcard;
    $('#card-actions').hidden = !vcard;
    share?.reset();
  }

  let timer = null;
  root.querySelectorAll('[data-key]').forEach((input) => {
    input.oninput = (e) => {
      agent[e.target.dataset.key] = e.target.value.trim();
      // Презентация показывает короткое имя: «Имя Фамилия».
      agent.name = [agent.firstName, agent.lastName].filter(Boolean).join(' ');
      redraw();
      clearTimeout(timer);
      timer = setTimeout(() => setSetting('agent', agent), 300);
    };
  });

  if (share) {
    shareBtn.onclick = async () => {
      let needDownload = false;
      try { needDownload = await share.run(); } catch { needDownload = true; }
      if (needDownload) downloadImage();
    };
  }
  $('#card-image').onclick = downloadImage;
  $('#card-vcf').onclick = () => {
    downloadBlob(new Blob([buildVCard(agent)], { type: 'text/vcard;charset=utf-8' }), `${fileBase()}.vcf`);
  };
  redraw();
}
