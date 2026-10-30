import './bootstrap.js';
import * as WizEditor from 'wiz-editor/client';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import frameCss from '../../public/editor/frame.css?raw';

const documentFont = 'Microsoft YaHei';

// Page layout for the PDF export; everything else comes from the editor's own styles.
const printCss = `
  @page { size: A4; margin: 18mm 16mm; }
  html, body { min-height: 0; background: #fff; }
  * { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  #editor > .editor-main { min-height: 0; --editor-width: 100%; }
  #editor > .editor-main > .root-container-extend { max-width: none; }
  #editor .editor-container.root-container { min-height: 0; padding: 0; }
  #editor .editor-block { break-inside: avoid-page; }
  .export-title { font-size: calc(var(--editor-font-size) * 1.875); font-weight: 600; line-height: 1.3; margin: 0 0 .6em; color: #1f2328; }
`;

(() => {
  'use strict';
  const channel = location.hash.slice(1);
  const parentOrigin = new URL(location.href).origin;
  const pending = new Map(),
    resources = new Map(),
    objectUrls = new Map(),
    blobs = new Map(),
    uploads = new Set();
  let editor = null,
    note = null,
    loaded = false,
    dirty = false,
    revision = 0,
    timer = null,
    sequence = 0,
    diagramTimer = null;
  const send = (message) =>
    parent.postMessage({ ...message, channel, bridge: 'wix-editor-v1' }, parentOrigin);
  function request(action, data) {
    const requestId = ++sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error('编辑器文件请求超时'));
      }, 60000);
      pending.set(requestId, { resolve, reject, timeout });
      send({ action, requestId, ...data });
    });
  }
  function addResource(asset) {
    if (!asset || !/^[a-f0-9-]{36}$/.test(asset.id) || !(asset.data instanceof ArrayBuffer)) return;
    const old = resources.get(asset.id);
    if (old) {
      URL.revokeObjectURL(old);
      blobs.delete(old);
    }
    const blob = new Blob([asset.data], { type: asset.mime });
    const url = URL.createObjectURL(blob);
    resources.set(asset.id, url);
    objectUrls.set(url, '/files/' + asset.id);
    blobs.set(url, blob);
  }
  function resourceUrl(src) {
    const id = String(src).match(/^(?:wix-resource:|\/files\/)([a-f0-9-]{36})$/)?.[1];
    return id ? resources.get(id) || '' : '';
  }
  function nativeHtml() {
    const dom = new DOMParser().parseFromString(editor.toHtml(), 'text/html');
    // The native export uses private CSS classes. Emit semantic fallback HTML for
    // shares, search, history and portable exports; editor.data() stays untouched.
    for (const control of dom.querySelectorAll('.editor-code-config,button,select,svg'))
      control.remove();
    for (const [name, tag] of Object.entries({
      'style-bold': 'strong',
      'style-italic': 'em',
      'style-underline': 'u',
      'style-strikethrough': 's',
      'style-code': 'code',
    })) {
      for (const element of dom.querySelectorAll('.' + name)) {
        const semantic = dom.createElement(tag);
        semantic.append(...element.childNodes);
        element.append(semantic);
      }
    }
    for (const block of dom.querySelectorAll('.code-block')) {
      const pre = dom.createElement('pre'),
        code = dom.createElement('code');
      code.textContent = [...block.querySelectorAll('.code-line-block')]
        .map((line) => line.textContent)
        .join('\n');
      pre.append(code);
      block.replaceWith(pre);
    }
    for (const list of dom.querySelectorAll('ol.list-ul')) {
      const ul = dom.createElement('ul');
      ul.append(...list.childNodes);
      list.replaceWith(ul);
    }
    for (const list of dom.querySelectorAll('ol:not(.list-ul)')) {
      const start = Number(list.getAttribute('start'));
      if (list.hasAttribute('start') && Number.isInteger(start))
        list.setAttribute('start', String(start + 1));
    }
    for (const block of dom.querySelectorAll('div.text-block')) {
      const semantic = dom.createElement(
        block.classList.contains('editor-quote-block') ? 'blockquote' : 'p',
      );
      const content = block.querySelector('.block-content');
      if (!content) continue;
      semantic.append(...content.childNodes);
      if (block.style.textAlign) semantic.style.textAlign = block.style.textAlign;
      block.replaceWith(semantic);
    }
    const comments = dom.createTreeWalker(dom.body, NodeFilter.SHOW_COMMENT),
      remove = [];
    while (comments.nextNode()) remove.push(comments.currentNode);
    remove.forEach((node) => node.remove());
    for (const image of dom.querySelectorAll('img')) {
      const src = image.getAttribute('src') || '';
      if (objectUrls.has(src)) image.setAttribute('src', objectUrls.get(src));
      else if (src.startsWith('wix-resource:'))
        image.setAttribute('src', src.replace('wix-resource:', '/files/'));
    }
    return dom.body.innerHTML;
  }
  const dataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('无法读取笔记图片'));
      reader.readAsDataURL(blob);
    });
  // A standalone page with the editor's native markup and styles, so the PDF keeps
  // the exact layout shown in the editor. Images are inlined: the renderer is offline.
  async function exportHtml(title) {
    const canvases = new Map();
    for (const canvas of editor.rootContainer().querySelectorAll('canvas'))
      canvases.set(canvas, canvas.toDataURL());
    const dom = new DOMParser().parseFromString(editor.toHtml(), 'text/html');
    for (const [canvas, src] of canvases) {
      const id = canvas.getAttribute('data-canvas-temp-id');
      const copy = id && dom.querySelector(`canvas[data-canvas-temp-id="${id}"]`);
      if (!copy) continue;
      const image = dom.createElement('img');
      image.src = src;
      image.style.cssText = `width:${canvas.clientWidth}px;height:${canvas.clientHeight}px`;
      copy.replaceWith(image);
    }
    for (const image of dom.querySelectorAll('img')) {
      const src = image.getAttribute('src') || '';
      const blob = blobs.get(src) || blobs.get(resourceUrl(src));
      if (blob) image.setAttribute('src', await dataUrl(blob));
      image.removeAttribute('srcset');
    }
    for (const control of dom.querySelectorAll('script,.block-tools,.editor-code-config,button'))
      control.remove();
    const main = dom.querySelector('.editor-main');
    if (main) {
      const fontSize = editor.rootElement.style.getPropertyValue('--editor-font-size') || '16px';
      main.style.setProperty('--editor-font-size', fontSize);
      const wrapper = dom.createElement('div');
      wrapper.id = 'editor';
      wrapper.className = 'desktop-editor';
      wrapper.style.setProperty('--editor-font-size', fontSize);
      const heading = dom.createElement('h1');
      heading.className = 'export-title';
      heading.textContent = title;
      main.before(wrapper);
      wrapper.append(heading, main);
    }
    const styles = [...document.querySelectorAll('style')].map((style) => style.textContent);
    for (const element of dom.head.querySelectorAll('style,link')) element.remove();
    const style = dom.createElement('style');
    style.textContent = [...styles, frameCss, printCss].join('\n');
    dom.head.append(style);
    return '<!doctype html>\n' + dom.documentElement.outerHTML;
  }
  async function exportDocx(title) {
    // toDocx reads doc.data() synchronously before its first await; prepend the note
    // title for that call only, so the Word file starts with it like the PDF does.
    const doc = editor.doc,
      data = doc.data,
      own = Object.hasOwn(doc, 'data');
    doc.data = function () {
      const value = data.call(this);
      const heading = {
        id: WizEditor.genId(),
        type: 'text',
        heading: 1,
        text: [{ insert: title }],
      };
      return { ...value, blocks: [heading, ...value.blocks] };
    };
    let docx;
    try {
      docx = editor.toDocx(undefined, false);
    } finally {
      if (own) doc.data = data;
      else delete doc.data;
    }
    return withDocumentFont(await docx);
  }
  // The built-in template leaves body text on Word's theme fonts (DengXian/SimSun for CJK);
  // use Microsoft YaHei like the editor. Code keeps Consolas for Latin text.
  async function withDocumentFont(blob) {
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    const fonts = `w:ascii="${documentFont}" w:eastAsia="${documentFont}" w:hAnsi="${documentFont}" w:cs="${documentFont}"`;
    files['word/styles.xml'] = strToU8(
      strFromU8(files['word/styles.xml'])
        .replace(/<w:rFonts w:asciiTheme="[^"]*"[^>]*\/>/g, `<w:rFonts ${fonts}/>`)
        .replaceAll('w:eastAsia="SimSun"', `w:eastAsia="${documentFont}"`),
    );
    return new Blob([zipSync(files)], { type: blob.type });
  }
  async function snapshot(requestId, attempt = 0) {
    if (!loaded || !editor) throw new Error('编辑器尚未加载');
    if (uploads.size) {
      await Promise.all([...uploads]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const capturedRevision = revision;
    const document = JSON.parse(
      JSON.stringify(editor.data(), (_key, value) =>
        typeof value === 'string' && objectUrls.has(value)
          ? objectUrls.get(value).replace('/files/', 'wix-resource:')
          : value,
      ),
    );
    const content = note.type === 'markdown' ? await editor.toMarkdown() : nativeHtml();
    if (revision !== capturedRevision) {
      if (attempt >= 8) throw new Error('正文仍在变化，请稍后重试保存');
      return snapshot(requestId, attempt + 1);
    }
    send({
      action: 'snapshot',
      requestId,
      changed: dirty,
      revision: capturedRevision,
      document,
      content,
    });
  }
  function changed() {
    if (!loaded || note.readOnly) return;
    dirty = true;
    revision++;
    send({ action: 'dirty' });
    clearTimeout(timer);
    timer = setTimeout(() => snapshot().catch(report), 80);
  }
  function report(error) {
    send({ action: 'error', error: error?.message || '编辑器发生错误' });
  }
  async function initialize(message) {
    loaded = false;
    dirty = false;
    clearTimeout(timer);
    editor?.destroy();
    note = message.note;
    for (const asset of message.assets || []) addResource(asset);
    const source = new DOMParser().parseFromString(note.content || '<p></p>', 'text/html');
    for (const image of source.querySelectorAll('img')) {
      const url = resourceUrl(image.getAttribute('src'));
      if (url) image.setAttribute('src', url);
    }
    const data =
      note.document ||
      (note.type === 'markdown'
        ? WizEditor.markdown2Doc(note.content || '')
        : WizEditor.html2Doc(source.body.innerHTML));
    const nativeDocument =
      data && Array.isArray(data.blocks) && data.blocks.length
        ? data
        : { blocks: [{ id: WizEditor.genId(), type: 'text', text: [] }], comments: {}, meta: {} };
    editor = await WizEditor.createEditorPromise(
      document.getElementById('editor'),
      {
        local: true,
        lang: 'zh-CN',
        titleInEditor: false,
        markdownOnly: note.type === 'markdown',
        initLocalData: nativeDocument,
        themeMode: note.theme || 'light',
        hideComments: true,
        serverUrl: '',
        placeholder: '输入文字，或按 + 插入内容',
        resourceProtocol: ['wix-resource:'],
        callbacks: {
          onBeginInitDrawIo: () => {
            clearTimeout(diagramTimer);
            diagramTimer = setTimeout(() => {
              // Release the plugin's exclusive block and close its loading overlay.
              window.postMessage(JSON.stringify({ event: 'init' }), '*');
              window.postMessage(JSON.stringify({ event: 'exit' }), '*');
              report(new Error('流程图编辑器加载失败，请检查网络后重试'));
            }, 20000);
          },
          onEndInitDrawIo: () => clearTimeout(diagramTimer),
          onChange: changed,
          onStatusChanged: (_editor, isDirty) => {
            if (isDirty) changed();
          },
          onError: (_editor, error) => report(error),
          onBuildResourceUrl: (_editor, src) => resourceUrl(src),
          // The default download is a credentialed XHR, which fails for blob: URLs in this
          // origin-less sandbox. Without this, reopening a saved diagram starts from an empty canvas.
          onDownloadImage: (_editor, url, download) => {
            const blob = blobs.get(url);
            return blob ? new File([blob], 'resource', { type: blob.type }) : download(url);
          },
          onClickLink: (_editor, event, anchor) => {
            event.preventDefault();
            send({ action: 'open-link', url: anchor.getAttribute('href') || '' });
            return true;
          },
          onUploadResource: async (_editor, file) => {
            if (note.readOnly) throw new Error('只读笔记不能上传');
            const task = request('upload', { file });
            uploads.add(task);
            try {
              const result = await task;
              addResource(result.asset);
              return 'wix-resource:' + result.asset.id;
            } finally {
              uploads.delete(task);
            }
          },
        },
      },
      {
        userId: 'local',
        appId: 'selfhosted',
        docId: note.id,
        displayName: 'Local',
        // Read-only mode is controlled by setReadOnly and can change without reloading.
        permission: 'w',
        token: '',
      },
    );
    editor
      .rootContainer()
      .setAttribute('aria-label', note.type === 'markdown' ? 'Markdown 正文' : '笔记正文');
    editor.rootContainer().setAttribute('role', 'textbox');
    loaded = true;
    configure(message.note);
    send({ action: 'loaded', engine: 'wiz-editor' });
  }
  function configure(config) {
    if (!editor) return;
    const theme = config.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.body.classList.toggle('dark', theme === 'dark');
    editor.themeMode = theme;
    editor.setThemeMode();
    editor.rootElement.style.setProperty(
      '--editor-font-size',
      (Number(config.fontSize) || 16) + 'px',
    );
    editor.setReadOnly(!!config.readOnly);
    note.readOnly = !!config.readOnly;
  }
  addEventListener('message', async (event) => {
    const message = event.data;
    if (
      event.source !== parent ||
      event.origin !== parentOrigin ||
      !message ||
      message.channel !== channel ||
      message.bridge !== 'wix-editor-v1'
    )
      return;
    try {
      if (message.action === 'init') await initialize(message);
      else if (message.action === 'configure') configure(message);
      else if (message.action === 'capture') {
        clearTimeout(timer);
        await snapshot(message.requestId);
      } else if (message.action === 'export') {
        if (!loaded || !editor) throw new Error('编辑器尚未加载');
        const title = String(message.title || '无标题笔记');
        const data = message.format === 'docx' ? await exportDocx(title) : await exportHtml(title);
        send({ action: 'exported', requestId: message.requestId, data });
      } else if (message.action === 'clean' && message.revision === revision) {
        dirty = false;
        editor?.onClean();
      } else if (message.action === 'hello') send({ action: 'ready' });
      else if (
        message.action === 'scroll-heading' &&
        Number.isInteger(message.index) &&
        message.index >= 0 &&
        message.index < 20000
      ) {
        editor
          ?.rootContainer()
          .querySelectorAll('h1.editor-block,h2.editor-block,h3.editor-block')
          [message.index]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (message.action === 'reply') {
        const item = pending.get(message.requestId);
        if (!item) return;
        pending.delete(message.requestId);
        clearTimeout(item.timeout);
        if (message.error) item.reject(new Error(message.error));
        else item.resolve(message.result);
      }
    } catch (error) {
      send({ action: 'error', error: error.message, requestId: message.requestId });
    }
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        ['s', 'k', 'n'].includes(event.key.toLowerCase())
      ) {
        event.preventDefault();
        event.stopPropagation();
        send({ action: 'shortcut', key: event.key.toLowerCase() });
      }
    },
    true,
  );
  // Double-clicking a note in reading mode asks the host to switch to editing.
  document.addEventListener('dblclick', () => {
    if (loaded && note?.readOnly) send({ action: 'request-edit' });
  });
  addEventListener('pagehide', () => {
    clearTimeout(timer);
    editor?.destroy();
    for (const url of resources.values()) URL.revokeObjectURL(url);
  });
  send({ action: 'ready' });
})();
