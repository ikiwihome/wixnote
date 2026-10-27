import './bootstrap.js';
import * as WizEditor from 'wiz-editor/client';

(() => {
  'use strict';
  const channel = location.hash.slice(1);
  const parentOrigin = new URL(location.href).origin;
  const pending = new Map(),
    resources = new Map(),
    objectUrls = new Map(),
    uploads = new Set();
  let editor = null,
    note = null,
    loaded = false,
    dirty = false,
    revision = 0,
    timer = null,
    sequence = 0;
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
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(new Blob([asset.data], { type: asset.mime }));
    resources.set(asset.id, url);
    objectUrls.set(url, '/files/' + asset.id);
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
  async function snapshot(requestId, attempt = 0) {
    if (!loaded || !editor) throw new Error('编辑器尚未加载');
    if (uploads.size) {
      await Promise.all([...uploads]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const capturedRevision = revision;
    const document = JSON.parse(JSON.stringify(editor.data()));
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
    const data =
      note.document ||
      (note.type === 'markdown'
        ? WizEditor.markdown2Doc(note.content || '')
        : WizEditor.html2Doc(note.content || '<p></p>'));
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
        placeholder: '输入文字，或按 / 插入内容',
        resourceProtocol: ['wix-resource:'],
        callbacks: {
          onChange: changed,
          onStatusChanged: (_editor, isDirty) => {
            if (isDirty) changed();
          },
          onError: (_editor, error) => report(error),
          onBuildResourceUrl: (_editor, src) => resourceUrl(src),
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
        permission: note.readOnly ? 'r' : 'w',
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
  addEventListener('pagehide', () => {
    clearTimeout(timer);
    editor?.destroy();
    for (const url of resources.values()) URL.revokeObjectURL(url);
  });
  send({ action: 'ready' });
})();
