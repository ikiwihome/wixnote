import { download, gzipJson, gzipJsonType } from './api.js';

// Both formats are rendered by the open editor from its native document, so the
// exported layout matches what the editor shows.
export async function exportDocument(editor, note, format, safeName) {
  if (!editor) throw new Error('编辑器尚未加载，请稍后重试导出');
  const title = note.title || '无标题笔记';
  if (format === 'word') {
    const word = await editor.export('docx', title);
    download(
      safeName + '.docx',
      word,
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    return;
  }
  const html = await editor.export('html', title);
  const response = await fetch('/api/export/pdf', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': gzipJsonType, 'X-Wix-Request': '1' },
    body: await gzipJson({ html }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || 'PDF 导出失败，请重试');
  }
  download(safeName + '.pdf', await response.blob(), 'application/pdf');
}
