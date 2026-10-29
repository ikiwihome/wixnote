import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { asBlob } from 'html-docx-js-typescript';
import { download } from './api.js';

// The same document styles are used by both export formats.
const documentStyles = `
  .export-document { font-family: "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", system-ui, sans-serif; font-size: 11pt; line-height: 1.65; color: #202124; background: #fff; overflow-wrap: break-word; }
  .export-document h1, .export-document h2, .export-document h3, .export-document h4, .export-document h5 { font-family: inherit; font-weight: bold; color: #17191c; line-height: 1.35; margin: 1em 0 .4em; }
  .export-document h1.export-title { font-size: 22pt; margin-top: 0; }
  .export-document h1 { font-size: 18pt; }
  .export-document h2 { font-size: 15pt; }
  .export-document h3 { font-size: 13pt; }
  .export-document h4 { font-size: 12pt; }
  .export-document h5 { font-size: 11pt; }
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
  title.className = 'export-title';
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
  const htmlDocument = `<!doctype html><html><head><meta charset="utf-8"><style>${documentStyles}
      @page { size: A4; margin: 22mm; }
      body { margin: 0; }
      .export-document { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      .export-document img { break-inside: avoid; }
    </style></head><body>${article.outerHTML}</body></html>`;
  const response = await fetch('/api/export/pdf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', 'X-Wix-Request': '1' },
    body: JSON.stringify({ html: htmlDocument }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'PDF 导出失败，请重试');
  }
  download(safeName + '.pdf', await response.blob(), 'application/pdf');
}
