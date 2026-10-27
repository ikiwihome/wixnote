import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { asBlob } from 'html-docx-js-typescript';
import { download } from './api.js';

// The same document styles are used by both export formats.
const documentStyles = `
  .export-document { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif; font-size: 11pt; line-height: 1.65; color: #202124; background: #fff; overflow-wrap: break-word; }
  .export-document h1, .export-document h2, .export-document h3, .export-document h4 { font-family: inherit; color: #17191c; line-height: 1.3; margin: 1em 0 .5em; }
  .export-document h1 { font-size: 22pt; margin-top: 0; }
  .export-document h2 { font-size: 16pt; }
  .export-document h3 { font-size: 13pt; }
  .export-document p { margin: 0 0 .75em; }
  .export-document img { max-width: 100%; height: auto; }
  .export-document table { border-collapse: collapse; width: 100%; margin: .75em 0; }
  .export-document th, .export-document td { border: 1px solid #b7bdc5; padding: 6px 8px; }
  .export-document blockquote { margin: .75em 0; padding-left: 1em; border-left: 3px solid #b7bdc5; color: #4b5563; }
  .export-document pre { white-space: pre-wrap; overflow-wrap: break-word; background: #f3f4f6; padding: .75em; }
  .export-document a { color: #245eb5; }
`;

async function inlineAttachments(document) {
  for (const image of document.querySelectorAll('img[src^="/files/"]')) {
    const response = await fetch(image.getAttribute('src'), { credentials: 'same-origin' });
    if (!response.ok) throw new Error('无法读取笔记图片，请重试导出');
    const blob = await response.blob();
    image.src = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取笔记图片'));
      reader.readAsDataURL(blob);
    });
  }
}

export async function exportDocument(note, format, safeName) {
  const html = DOMPurify.sanitize(
    note.type === 'markdown' ? marked.parse(note.content) : note.content,
  );
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  await inlineAttachments(parsed);
  const title = document.createElement('h1');
  title.textContent = note.title || '无标题笔记';
  const article = document.createElement('div');
  article.className = 'export-document';
  article.style.fontFamily =
    '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif';
  article.style.fontSize = '11pt';
  article.style.lineHeight = '1.65';
  article.append(title, ...parsed.body.childNodes);
  if (format === 'word') {
    const htmlDocument = `<!doctype html><html><head><meta charset="utf-8"><style>${documentStyles}</style></head><body>${article.outerHTML}</body></html>`;
    const word = await asBlob(htmlDocument, {
      margins: { top: 1247, bottom: 1247, left: 1247, right: 1247 },
    });
    download(
      safeName + '.docx',
      word,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    return;
  }
  const style = document.createElement('style');
  style.textContent = documentStyles;
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:166mm;';
  host.append(article);
  document.head.append(style);
  document.body.append(host);
  try {
    await Promise.all(
      [...article.querySelectorAll('img')].map((img) => img.decode().catch(() => {})),
    );
    const { default: html2pdf } = await import('html2pdf.js');
    const pdf = await html2pdf()
      .set({
        margin: 22,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, backgroundColor: '#ffffff', useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(article)
      .outputPdf('blob');
    download(safeName + '.pdf', pdf, 'application/pdf');
  } finally {
    host.remove();
    style.remove();
  }
}
