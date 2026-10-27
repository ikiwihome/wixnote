import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

export function SafeContent({ content, type, className = '' }) {
  return (
    <div
      className={'rendered-content ' + className}
      dangerouslySetInnerHTML={{
        __html: DOMPurify.sanitize(
          type === 'markdown' ? marked.parse(content || '') : content || '',
          { ADD_ATTR: ['target', 'data-type', 'data-checked'] },
        ),
      }}
    />
  );
}

export default function NoteEditor({
  note,
  onChange,
  onDirty,
  onUpload,
  readOnly,
  editorRef,
  fontSize = 16,
  theme = 'light',
  onError,
}) {
  const frame = useRef(),
    callbacks = useRef(),
    initialNote = useRef(note);
  callbacks.current = { onChange, onDirty, onUpload, onError, readOnly, theme, fontSize };
  const [channel] = useState(() => crypto.randomUUID());
  const [state, setState] = useState('loading');
  const [pendingLink, setPendingLink] = useState(null);
  const bridge = useRef(null);
  useEffect(() => {
    const note = initialNote.current;
    let active = true,
      initialized = false,
      loaded = false,
      sequence = 0,
      lastSnapshot = null,
      loadError = null;
    let resolveLoaded;
    const loadedPromise = new Promise((resolve) => {
      resolveLoaded = resolve;
    });
    const pending = new Map();
    const send = (message, transfer = []) =>
      frame.current?.contentWindow?.postMessage(
        { ...message, channel, bridge: 'wix-editor-v1' },
        '*',
        transfer,
      );
    const resolveTheme = (theme) =>
      theme === 'system'
        ? matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : theme;
    async function asset(item) {
      const response = await fetch('/files/' + item.id, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('无法读取编辑器图片');
      return { id: item.id, mime: item.mime, data: await response.arrayBuffer() };
    }
    async function initialize() {
      if (initialized || !active) return;
      initialized = true;
      try {
        const results = await Promise.allSettled(
          note.attachments.filter((a) => a.mime.startsWith('image/')).map(asset),
        );
        if (!active) return;
        const assets = results
          .filter((item) => item.status === 'fulfilled')
          .map((item) => item.value);
        if (results.some((item) => item.status === 'rejected'))
          callbacks.current.onError(new Error('部分图片无法读取，正文仍可编辑'));
        send(
          {
            action: 'init',
            note: {
              id: note.id,
              type: note.type,
              content: note.type === 'markdown' ? note.content : DOMPurify.sanitize(note.content),
              document: note.editor_data || null,
              readOnly: !!callbacks.current.readOnly,
              theme: resolveTheme(callbacks.current.theme),
              fontSize: callbacks.current.fontSize,
            },
            assets,
          },
          assets.map((a) => a.data),
        );
      } catch (error) {
        loadError = error;
        resolveLoaded();
        setState('error');
        callbacks.current.onError(error);
      }
    }
    function acceptSnapshot(message) {
      callbacks.current.onDirty?.(false);
      if (!message.changed || callbacks.current.readOnly) return;
      const content =
        note.type === 'markdown' ? message.content : DOMPurify.sanitize(message.content);
      const fingerprint = JSON.stringify([content, message.document]);
      if (fingerprint === lastSnapshot) return;
      lastSnapshot = fingerprint;
      callbacks.current.onChange({ content, editor_data: message.document });
    }
    async function receive(event) {
      const message = event.data;
      if (
        !active ||
        event.source !== frame.current?.contentWindow ||
        event.origin !== 'null' ||
        !message ||
        message.channel !== channel ||
        message.bridge !== 'wix-editor-v1'
      )
        return;
      if (message.action === 'ready') {
        await initialize();
        return;
      }
      if (message.action === 'loaded') {
        loaded = true;
        resolveLoaded();
        setState('ready');
        return;
      }
      if (message.action === 'dirty') {
        if (!callbacks.current.readOnly) callbacks.current.onDirty?.(true);
        return;
      }
      if (message.action === 'snapshot') {
        if (
          typeof message.content !== 'string' ||
          !message.document ||
          !Array.isArray(message.document.blocks)
        )
          return;
        acceptSnapshot(message);
        send({ action: 'clean', revision: message.revision });
        const item = pending.get(message.requestId);
        if (item) {
          clearTimeout(item.timer);
          pending.delete(message.requestId);
          item.resolve();
        }
        return;
      }
      if (message.action === 'error') {
        const error = new Error(message.error || '编辑器加载失败');
        if (!loaded) {
          loadError = error;
          resolveLoaded();
          setState('error');
        }
        const item = pending.get(message.requestId);
        if (item) {
          clearTimeout(item.timer);
          pending.delete(message.requestId);
          item.reject(error);
        }
        callbacks.current.onError(error);
        return;
      }
      if (message.action === 'shortcut' && ['s', 'k', 'n'].includes(message.key)) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: message.key, ctrlKey: true }));
        return;
      }
      if (message.action === 'open-link') {
        try {
          const url = new URL(String(message.url).slice(0, 4000), location.origin);
          if (['http:', 'https:', 'mailto:'].includes(url.protocol))
            setPendingLink((previous) => previous || url.href);
        } catch {
          // Ignore malformed links in note content.
        }
        return;
      }
      if (message.action === 'upload') {
        try {
          if (callbacks.current.readOnly || !(message.file instanceof Blob))
            throw new Error('不允许此文件请求');
          const file = new File([message.file], message.file.name || 'attachment', {
            type: message.file.type,
          });
          const item = await callbacks.current.onUpload(file);
          const result = { asset: await asset(item) };
          if (active)
            send({ action: 'reply', requestId: message.requestId, result }, [result.asset.data]);
        } catch (error) {
          if (active) send({ action: 'reply', requestId: message.requestId, error: error.message });
        }
      }
    }
    window.addEventListener('message', receive);
    const controller = {
      async flush() {
        let timer;
        try {
          await Promise.race([
            loadedPromise,
            new Promise((_, reject) => {
              timer = setTimeout(() => reject(new Error('编辑器加载超时')), 10000);
            }),
          ]);
        } finally {
          clearTimeout(timer);
        }
        // Failed initialization cannot contain user edits. Preserve the stored
        // document and allow navigation/backup instead of trapping the workspace.
        if (loadError) return;
        if (!active) throw new Error('编辑器已切换');
        const requestId = ++sequence;
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error('等待编辑器保存超时'));
          }, 65000);
          pending.set(requestId, { resolve, reject, timer });
          send({ action: 'capture', requestId });
        });
      },
      scrollHeading(index) {
        send({ action: 'scroll-heading', index });
      },
      configure(options) {
        send({ action: 'configure', ...options });
      },
    };
    bridge.current = { send };
    editorRef.current = controller;
    setState('loading');
    setPendingLink(null);
    return () => {
      active = false;
      window.removeEventListener('message', receive);
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(new Error('编辑器已关闭'));
      }
      pending.clear();
      if (editorRef.current === controller) editorRef.current = null;
      bridge.current = null;
    };
  }, [channel, editorRef]);
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const configure = () =>
      editorRef.current?.configure({
        theme: theme === 'system' ? (media.matches ? 'dark' : 'light') : theme,
        fontSize,
        readOnly: !!readOnly,
      });
    configure();
    media.addEventListener('change', configure);
    return () => media.removeEventListener('change', configure);
  }, [theme, fontSize, readOnly, state, editorRef]);
  return (
    <div
      className="native-editor-shell"
      data-engine="wiz-editor"
      style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex' }}
    >
      {state !== 'ready' && (
        <div className="native-editor-status" role="status">
          {state === 'error' ? '编辑器加载失败，请重新载入笔记' : '正在加载编辑器…'}
        </div>
      )}
      {pendingLink && (
        <div className="native-link-popup">
          <span>{pendingLink}</span>
          <a
            href={pendingLink}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setPendingLink(null)}
          >
            打开链接
          </a>
          <button onClick={() => setPendingLink(null)}>关闭</button>
        </div>
      )}
      <iframe
        key={channel}
        ref={frame}
        src={'/editor/frame.html#' + channel}
        title="编辑器"
        sandbox="allow-scripts"
        onLoad={() => bridge.current?.send({ action: 'hello' })}
        style={{
          border: 0,
          width: '100%',
          height: '100%',
          flex: 1,
          minHeight: 0,
          visibility: state === 'error' ? 'hidden' : 'visible',
        }}
      />
    </div>
  );
}
