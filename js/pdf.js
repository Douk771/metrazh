// Минимальный PDF без библиотек: каждая страница — одна JPEG-картинка на весь лист A4.
// Страницы рисуются на canvas системными шрифтами, поэтому кириллица работает без файлов шрифтов.

export const A4 = { w: 595.28, h: 841.89 }; // в пунктах

// pages: [{ jpeg: Blob, width, height }] — width/height в пикселях
export async function makePdf(pages, { title = '' } = {}) {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const push = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const obj = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };

  // Номера объектов: 1 — каталог, 2 — список страниц, 3 — сведения, далее по 3 на страницу.
  const pageIds = pages.map((_, i) => 4 + i * 3);
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  obj(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  obj(2, () => push(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`));
  obj(3, () => push(`<< /Title ${pdfString(title)} /Producer (Metrazh) >>`));

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const [pageId, contentId, imageId] = [pageIds[i], pageIds[i] + 1, pageIds[i] + 2];
    const content = `q ${A4.w} 0 0 ${A4.h} 0 0 cm /Im0 Do Q`;
    const jpeg = new Uint8Array(await p.jpeg.arrayBuffer());

    obj(pageId, () => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.w} ${A4.h}] ` +
      `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    obj(contentId, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
    obj(imageId, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB ` +
        `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg);
      push('\nendstream');
    });
  }

  const count = 4 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${count}\n0000000000 65535 f \n`);
  for (let n = 1; n < count; n++) push(`${String(offsets[n]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

// Строка в UTF-16BE с BOM — так PDF-читалки показывают кириллицу в свойствах файла.
function pdfString(s) {
  let hex = 'FEFF';
  for (const ch of String(s)) {
    const code = ch.codePointAt(0);
    if (code > 0xffff) continue;
    hex += code.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}
