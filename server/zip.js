import AdmZip from 'adm-zip';
import sanitizeHtml from 'sanitize-html';
import { decodeHTML } from 'entities';
import { inflateRawSync, crc32 } from 'node:zlib';
import { editorData } from './document.js';
const failure = (message) =>
  Object.assign(new Error(message), { status: 400, publicMessage: true });

function readEntry(entry, limit) {
  if (entry.header.size > limit) throw failure('ZIP 解压后超过文件大小限制');
  let data;
  try {
    const compressed = entry.getCompressedData();
    if (entry.header.method === 0) data = compressed;
    else if (entry.header.method === 8)
      data = inflateRawSync(compressed, {
        maxOutputLength: Math.max(1, Math.min(limit, entry.header.size + 1)),
      });
    else throw failure('不支持此 ZIP 压缩方法');
  } catch (error) {
    throw failure(error.status ? error.message : 'ZIP 资源损坏或解压大小超限');
  }
  if (
    data.length !== entry.header.size ||
    data.length > limit ||
    crc32(data) >>> 0 !== entry.header.crc >>> 0
  )
    throw failure('ZIP 资源长度或校验不匹配');
  return data;
}
// A backup holds backup.json (the index) plus notes/*.html, revisions/*.html and attachments/*.
export function readBackupZip(buffer, maxBytes = 512 * 1024 * 1024) {
  try {
    const entries = new AdmZip(buffer).getEntries();
    if (entries.length > 300000) throw failure('备份 ZIP 文件数量过多');
    const files = new Map();
    let total = 0;
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      if (entry.header.flags & 1) throw failure('不支持加密的备份 ZIP');
      total += entry.header.size;
      if (total > maxBytes) throw failure('备份 ZIP 解压后超过大小限制');
      files.set(entry.entryName, readEntry(entry, maxBytes));
    }
    const index = files.get('backup.json');
    if (!index) throw failure('备份 ZIP 缺少 backup.json');
    files.delete('backup.json');
    return { data: JSON.parse(index.toString('utf8')), files };
  } catch (err) {
    if (err.status) throw err;
    throw failure('备份 ZIP 损坏或格式不正确');
  }
}
export function writeBackupZip(data, files) {
  const zip = new AdmZip();
  zip.addFile('backup.json', Buffer.from(JSON.stringify(data, null, 2)));
  for (const [name, value] of files) zip.addFile(name, Buffer.from(value));
  return zip.toBuffer();
}
export function readZip(buffer, maxBytes = 100 * 1024 * 1024) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw failure('不是有效的 ZIP 文件');
  }
  const entries = zip.getEntries();
  if (entries.length > 2000) throw failure('ZIP 文件资源数量过多');
  let total = 0;
  for (const entry of entries) {
    const name = entry.entryName;
    if (
      name.includes('\\') ||
      name.startsWith('/') ||
      name.split('/').includes('..') ||
      entry.header.flags & 1
    )
      throw failure('不支持路径异常或加密的 ZIP 文件');
    total += entry.header.size;
    if (total > maxBytes) throw failure('ZIP 解压后超过文件大小限制');
  }
  const index = entries.find((e) => e.entryName === 'index.html');
  if (!index) throw failure('ZIP 文件缺少 index.html');
  let raw;
  try {
    raw = readEntry(index, Math.min(maxBytes, 10 * 1024 * 1024));
  } catch {
    throw failure('ZIP 正文损坏、大小超限或已加密');
  }
  if (raw.length > 10 * 1024 * 1024) throw failure('ZIP 正文过大');
  if (((raw[0] === 255 && raw[1] === 254) || (raw[0] === 254 && raw[1] === 255)) && raw.length % 2)
    throw failure('ZIP UTF-16 正文损坏');
  const html =
    raw[0] === 255 && raw[1] === 254
      ? raw.subarray(2).toString('utf16le')
      : raw[0] === 254 && raw[1] === 255
        ? Buffer.from(raw.subarray(2)).swap16().toString('utf16le')
        : raw.toString('utf8').replace(/^\uFEFF/, '');
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] || html;
  const marker = html.match(/wix-editor-doc::([A-Za-z0-9+/=]+)::wix-editor-doc/);
  let document = null;
  if (marker) {
    if (marker[1].length > 7_000_000) throw failure('ZIP 原生编辑文档过大');
    try {
      document = editorData(Buffer.from(marker[1], 'base64').toString('utf8'));
    } catch {
      throw failure('ZIP 原生编辑文档损坏');
    }
  }
  const assets = [];
  for (const entry of entries) {
    if (entry.isDirectory || !entry.entryName.startsWith('index_files/')) continue;
    let data;
    try {
      data = readEntry(entry, maxBytes);
    } catch {
      throw failure('ZIP 资源损坏');
    }
    if (data.length !== entry.header.size) throw failure('ZIP 资源长度不匹配');
    assets.push({ path: entry.entryName, data });
  }
  return {
    title: decodeHTML(sanitizeHtml(title || '', { allowedTags: [], allowedAttributes: {} })).slice(
      0,
      500,
    ),
    content: body,
    editor_data: document,
    assets,
  };
}
export function writeZip(note, attachments) {
  const zip = new AdmZip();
  const paths = new Map();
  for (const item of attachments) {
    const ext =
      { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp' }[
        item.mime
      ] || '';
    const name = 'index_files/' + item.id + ext;
    paths.set(item.id, name);
    zip.addFile(name, item.data);
  }
  const content = note.content.replace(
    /\/files\/([a-f0-9-]{36})/g,
    (_m, id) => paths.get(id) || _m,
  );
  const title = note.title
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const native = editorData(note.editor_data);
  const marker = native
    ? '<!--wix-editor-doc::' +
      Buffer.from(
        JSON.stringify(native).replace(
          /(?:\/files\/|wix-resource:)([a-f0-9-]{36})/g,
          (_match, id) => paths.get(id) || _match,
        ),
        'utf8',
      ).toString('base64') +
      '::wix-editor-doc-->'
    : '';
  const document =
    '<!DOCTYPE HTML><html><head><meta charset="utf-16"><title>' +
    title +
    '</title>' +
    marker +
    '</head><body>' +
    content +
    '</body></html>';
  zip.addFile(
    'index.html',
    Buffer.concat([Buffer.from([255, 254]), Buffer.from(document, 'utf16le')]),
  );
  return zip.toBuffer();
}
