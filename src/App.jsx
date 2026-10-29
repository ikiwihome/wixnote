import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Search,
  Plus,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FileText,
  Star,
  Trash2,
  Settings as SettingsIcon,
  LogOut,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  Hash,
  Pin,
  Paperclip,
  Share2,
  History as HistoryIcon,
  Info,
  MessageSquare,
  ListTree,
  Check,
  Loader2,
  AlertCircle,
  RefreshCw,
  ArrowDownWideNarrow,
  Copy,
  Download,
  Upload,
  BookOpen,
  X,
  Menu,
  Maximize2,
  Minimize2,
  ArrowLeft,
  RotateCcw,
  FolderInput,
  Link2,
  Save,
  Pencil,
  Eye,
  EyeOff,
} from 'lucide-react';
import TurndownService from 'turndown';
import { exportDocument } from './export.js';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import NoteEditor, { SafeContent } from './Editor.jsx';
import AuthBackground from './AuthBackground.jsx';
import { api, download, date, bytes } from './api.js';
import {
  IconButton,
  SavedTime,
  Modal,
  PromptDialog,
  Dropdown,
  Collapse,
  Settings,
  History,
  ShareDialog,
  Comments,
  templates,
  outlineTemplate,
} from './components.jsx';

function Auth({ auth, onLogin }) {
  const [register, setRegister] = useState(auth.needsSetup),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [showPassword, setShowPassword] = useState(false),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  // Tabs only make sense when there is something to switch to.
  const canRegister = auth.needsSetup || auth.allowRegistration;
  return (
    <div className="auth-screen">
      <AuthBackground />
      <section className={'auth-card ' + (register ? 'register-card' : '')}>
        <img className="auth-logo" src="/favicon.svg" alt="" />
        <h1>灵眸笔记</h1>
        <p className="auth-subtitle">安静地记录，清晰地思考</p>
        {canRegister && (
          <>
            <nav className="auth-tabs">
              <button
                className={!register ? 'selected' : ''}
                onClick={() => {
                  setRegister(false);
                  setShowPassword(false);
                  setErr('');
                }}
              >
                登录
              </button>
              <button
                className={register ? 'selected' : ''}
                onClick={() => {
                  setRegister(true);
                  setShowPassword(false);
                  setErr('');
                }}
              >
                注册
              </button>
            </nav>
            <p className="setup-hint">
              {!register
                ? '欢迎回来，登录后继续你的记录'
                : auth.needsSetup
                  ? '创建首个账户，开始使用你的私人笔记空间'
                  : '创建账户，开始使用你的私人笔记空间'}
            </p>
          </>
        )}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setErr('');
            setBusy(true);
            try {
              const data = await api('/auth/' + (register ? 'register' : 'login'), {
                method: 'POST',
                body: { name, email, password },
              });
              onLogin(data.user);
            } catch (e) {
              setErr(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {register && (
            <label className="field">
              <span>昵称</span>
              <input
                aria-label="昵称"
                required
                autoFocus
                maxLength={100}
                autoComplete="nickname"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="昵称"
              />
            </label>
          )}
          <label className="field">
            <span>邮箱</span>
            <input
              aria-label="邮箱"
              required
              type="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="邮箱"
            />
          </label>
          <div className="field">
            <label htmlFor="auth-password">密码</label>
            <span className="auth-password">
              <input
                id="auth-password"
                aria-label="密码"
                aria-describedby={register ? 'auth-password-hint' : undefined}
                required
                type={showPassword ? 'text' : 'password'}
                minLength={register ? 10 : 1}
                maxLength={200}
                autoComplete={register ? 'new-password' : 'current-password'}
                autoCapitalize="none"
                spellCheck={false}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={register ? '设置密码' : '输入密码'}
              />
              <button
                type="button"
                className="auth-password-toggle"
                aria-label={showPassword ? '隐藏密码' : '显示密码'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </span>
            {register && (
              <span id="auth-password-hint" className="auth-field-hint">
                至少 10 位
              </span>
            )}
          </div>
          {err && (
            <p className="error-text" role="alert">
              {err}
            </p>
          )}
          <button
            className="primary auth-submit"
            disabled={busy || !email || !password || (register && !name)}
          >
            {busy ? <Loader2 className="spin" size={17} /> : null}
            {register ? '创建账户' : '登录'}
          </button>
        </form>
      </section>
    </div>
  );
}
function PublicNote({ token }) {
  const [note, setNote] = useState(null),
    [err, setErr] = useState('');
  useEffect(() => {
    api('/public/' + token)
      .then(setNote)
      .catch((e) => setErr(e.message));
  }, [token]);
  return (
    <div className="public-page">
      <header>
        <img src="/favicon.svg" alt="" />
        <strong>灵眸笔记</strong>
        <span>分享笔记</span>
      </header>
      <article>
        {err ? (
          <div className="empty-state">
            <Link2 size={40} />
            <h2>{err}</h2>
          </div>
        ) : !note ? (
          <div className="empty-state">加载中…</div>
        ) : (
          <>
            <h1>{note.title}</h1>
            <p className="muted small">
              {note.author} · 更新于 {date(note.updated_at)}
            </p>
            <SafeContent content={note.content} type={note.type} />
          </>
        )}
      </article>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(null),
    [error, setError] = useState('');
  const publicToken = location.pathname.match(/^\/s\/([a-f0-9]{48})$/)?.[1];
  useEffect(() => {
    if (publicToken) return;
    let active = true;
    let timer;
    const connect = async () => {
      try {
        const result = await api('/auth');
        if (active) {
          setError('');
          setAuth(result);
        }
      } catch (e) {
        if (active) {
          setError(e.message);
          timer = setTimeout(connect, 5000);
        }
      }
    };
    connect();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [publicToken]);
  if (publicToken) return <PublicNote token={publicToken} />;
  if (error)
    return (
      <div className="boot-screen">
        <AlertCircle />
        <p>{error}</p>
        <button className="primary" onClick={() => location.reload()}>
          重新连接
        </button>
      </div>
    );
  if (!auth)
    return (
      <div className="boot-screen">
        <Loader2 className="spin" />
        <p>正在打开笔记空间…</p>
      </div>
    );
  if (!auth.user)
    return <Auth auth={auth} onLogin={(user) => setAuth({ ...auth, user, needsSetup: false })} />;
  return <Workspace onLogout={() => setAuth({ ...auth, user: null, needsSetup: false })} />;
}

function Workspace({ onLogout }) {
  const [boot, setBoot] = useState(null),
    [notes, setNotes] = useState([]),
    [draft, setDraft] = useState(null),
    [editing, setEditing] = useState(false),
    [scope, setScope] = useState({ view: 'all' }),
    [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [sort, setSort] = useState('updated'),
    [direction, setDirection] = useState('desc'),
    [expanded, setExpanded] = useState({}),
    [tagsOpen, setTagsOpen] = useState(true),
    [foldersOpen, setFoldersOpen] = useState(true),
    [menu, setMenu] = useState(null),
    [dialog, setDialog] = useState(null),
    [toast, setToast] = useState(null),
    [saveStatus, setSaveStatus] = useState('saved'),
    [saveError, setSaveError] = useState(''),
    [listLoading, setListLoading] = useState(true),
    [resetKey, setResetKey] = useState(0),
    [refreshKey, setRefreshKey] = useState(0),
    [sidePanel, setSidePanel] = useState(null),
    [lastPanel, setLastPanel] = useState(null),
    [focus, setFocus] = useState(false),
    [mobilePane, setMobilePane] = useState('list'),
    [navigation, setNavigation] = useState(true),
    [panelWidths, setPanelWidths] = useState({ left: 240, middle: 300 });
  const draftRef = useRef(null),
    serverRef = useRef(null),
    dirtyRef = useRef(0),
    nativeDirtyRef = useRef(false),
    attachmentEpoch = useRef(0),
    pendingRef = useRef(null),
    flushRef = useRef(null),
    listSequence = useRef(0),
    openSequence = useRef(0),
    searchInput = useRef(),
    importInput = useRef(),
    editorRef = useRef(),
    toastTimer = useRef();
  const notify = useCallback((value, type = 'success') => {
    setToast({ message: typeof value === 'string' ? value : value.message, type });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 5500);
  }, []);
  const onError = useCallback((e) => notify(e, 'error'), [notify]);
  const refresh = useCallback(
    async (silent = false) => {
      try {
        const data = await api('/bootstrap');
        setBoot(data);
        return data;
      } catch (e) {
        if (!silent) onError(e);
      }
    },
    [onError],
  );
  useEffect(() => {
    refresh();
    return () => {
      clearTimeout(toastTimer.current);
    };
  }, [refresh]);
  useEffect(() => {
    const sync = async () => {
      if (document.visibilityState !== 'visible') return;
      if (await refresh(true)) setRefreshKey((k) => k + 1);
    };
    const timer = setInterval(sync, 30000);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      clearInterval(timer);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [refresh]);
  useEffect(() => {
    const id = setTimeout(() => setSearch(query), 220);
    return () => clearTimeout(id);
  }, [query]);
  useEffect(() => {
    const theme = boot?.settings.theme || 'light',
      media = matchMedia('(prefers-color-scheme: dark)');
    const apply = () =>
      (document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [boot?.settings.theme]);
  const assign = useCallback((row) => {
    openSequence.current++;
    attachmentEpoch.current++;
    serverRef.current = row;
    let recovered = null;
    try {
      const stored = JSON.parse(localStorage.getItem('wixnote-draft-' + row?.id));
      if (stored && stored.version === row?.version)
        recovered = { ...row, ...stored, favorite: row.favorite, attachments: row.attachments };
    } catch {
      /* Ignore invalid local drafts. */
    }
    row = recovered || row;
    draftRef.current = row;
    dirtyRef.current = recovered ? 1 : 0;
    nativeDirtyRef.current = false;
    setDraft(row);
    setSaveStatus(recovered ? 'dirty' : 'saved');
    setSaveError('');
    setEditing(!!recovered);
    setResetKey((k) => k + 1);
  }, []);
  const summary = (note) => ({
    ...note,
    excerpt: note.text?.slice(0, 240) || '',
    attachment_count: note.attachments?.length || 0,
  });
  const flush = useCallback(async () => {
    if (pendingRef.current) return pendingRef.current;
    const task = (async () => {
      try {
        await editorRef.current?.flush();
      } catch (e) {
        onError(e);
        return false;
      }
      if (!dirtyRef.current || !draftRef.current) return true;
      const snapshot = draftRef.current,
        previous = serverRef.current,
        version = previous.version,
        generation = dirtyRef.current,
        attachmentsAtStart = attachmentEpoch.current;
      setSaveStatus('saving');
      setSaveError('');
      try {
        const saved = await api('/notes/' + snapshot.id, {
          method: 'PATCH',
          body: {
            title: snapshot.title,
            content: snapshot.content,
            editor_data: snapshot.editor_data ?? null,
            type: snapshot.type,
            folder_id: snapshot.folder_id,
            tags: snapshot.tags.map((t) => t.id),
            pinned: snapshot.pinned,
            version,
          },
        });
        if (draftRef.current?.id === saved.id) {
          if (attachmentEpoch.current !== attachmentsAtStart)
            saved.attachments = draftRef.current.attachments;
          // A favorite toggled while this save was in flight is newer than the response.
          saved.favorite = draftRef.current.favorite;
          serverRef.current = saved;
          if (dirtyRef.current === generation && !nativeDirtyRef.current) {
            dirtyRef.current = 0;
            localStorage.removeItem('wixnote-draft-' + saved.id);
            if (localStorage.getItem('wixnote-active-draft') === saved.id)
              localStorage.removeItem('wixnote-active-draft');
            draftRef.current = saved;
            setDraft(saved);
            setSaveStatus('saved');
          } else {
            draftRef.current = {
              ...draftRef.current,
              version: saved.version,
              updated_at: saved.updated_at,
            };
            setDraft(draftRef.current);
            setSaveStatus('dirty');
          }
        }
        setNotes((rows) => rows.map((n) => (n.id === saved.id ? summary(saved) : n)));
        refresh();
        if (
          saved.folder_id !== previous.folder_id ||
          saved.tags
            .map((t) => t.id)
            .sort()
            .join() !==
            previous.tags
              .map((t) => t.id)
              .sort()
              .join()
        )
          setRefreshKey((k) => k + 1);
        return true;
      } catch (e) {
        setSaveStatus(e.status === 409 ? 'conflict' : 'error');
        setSaveError(e.status ? e.message : '无法连接服务器，请检查网络连接后重试。');
        onError(e);
        return false;
      }
    })();
    pendingRef.current = task;
    const result = await task;
    pendingRef.current = null;
    return result;
  }, [onError, refresh]);
  flushRef.current = flush;
  const ensureSaved = useCallback(async () => {
    if (pendingRef.current && !(await pendingRef.current)) return false;
    if (dirtyRef.current || nativeDirtyRef.current) {
      notify('当前笔记有未保存的修改，请先点击保存图标');
      return false;
    }
    return true;
  }, [notify]);
  const edit = useCallback((patch) => {
    if (!draftRef.current || draftRef.current.deleted_at) return;
    draftRef.current = { ...draftRef.current, ...patch };
    dirtyRef.current++;
    try {
      localStorage.setItem(
        'wixnote-draft-' + draftRef.current.id,
        JSON.stringify(draftRef.current),
      );
      localStorage.setItem('wixnote-active-draft', draftRef.current.id);
    } catch {
      /* Storage may be unavailable. */
    }
    setDraft(draftRef.current);
    setSaveStatus('dirty');
  }, []);
  const openNote = useCallback(
    async (id, reveal = true) => {
      const seq = ++openSequence.current;
      if (draftRef.current?.id === id) {
        if (reveal) setMobilePane('note');
        return true;
      }
      if (!(await ensureSaved())) return false;
      try {
        const row = await api('/notes/' + id);
        if (seq !== openSequence.current) return false;
        assign(row);
        setSidePanel(null);
        if (reveal) setMobilePane('note');
        return true;
      } catch (e) {
        onError(e);
        return false;
      }
    },
    [ensureSaved, assign, onError],
  );
  const ready = !!boot;
  useEffect(() => {
    if (!ready) return;
    const seq = ++listSequence.current;
    setListLoading(true);
    const params = new URLSearchParams({ ...scope, q: search, sort, direction });
    api('/notes?' + params)
      .then(async (rows) => {
        if (seq !== listSequence.current) return;
        setNotes(rows);
        setListLoading(false);
        if (!rows.some((r) => r.id === draftRef.current?.id)) {
          const recoveredId = localStorage.getItem('wixnote-active-draft');
          const target = rows.find((row) => row.id === recoveredId) || rows[0];
          if (target) await openNote(target.id, false);
          else if (await ensureSaved()) {
            if (seq === listSequence.current) {
              openSequence.current++;
              assign(null);
            }
          }
        }
      })
      .catch((e) => {
        if (seq === listSequence.current) {
          onError(e);
          setListLoading(false);
        }
      });
  }, [ready, scope, search, sort, direction, refreshKey, assign, ensureSaved, onError, openNote]);
  useEffect(() => {
    const before = (e) => {
      if (dirtyRef.current || nativeDirtyRef.current || pendingRef.current) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', before);
    return () => window.removeEventListener('beforeunload', before);
  }, []);
  useEffect(() => {
    const key = (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        flushRef.current();
      }
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setNavigation(true);
        setMobilePane('list');
        setTimeout(() => searchInput.current?.focus(), 0);
      }
      if (e.key.toLowerCase() === 'n') {
        e.preventDefault();
        if (!dialog) createNote();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const changeScope = async (value) => {
    if (!(await ensureSaved())) return;
    setScope(value);
    setQuery('');
    setMobilePane('list');
  };
  async function createNote(template = templates[0]) {
    if (!(await ensureSaved())) return;
    try {
      const row = await api('/notes', {
        method: 'POST',
        body: {
          title: template.id === 'blank' ? '无标题笔记' : template.name,
          content: template.content,
          type: template.type,
          folder_id: scope.folder || boot.folders[0]?.id || null,
          tags: scope.tag ? [scope.tag] : [],
        },
      });
      listSequence.current++;
      assign(row);
      setEditing(true);
      setNotes((rows) => [summary(row), ...rows]);
      if (scope.view === 'trash' || scope.view === 'favorites') setScope({ view: 'all' });
      setRefreshKey((n) => n + 1);
      refresh();
      setMobilePane('note');
      setDialog(null);
      setTimeout(() => document.querySelector('.note-title')?.focus(), 50);
    } catch (e) {
      onError(e);
    }
  }
  async function mutateNote(id, patch) {
    if (!(await ensureSaved())) return;
    try {
      const source = id === draftRef.current?.id ? serverRef.current : await api('/notes/' + id),
        row = await api('/notes/' + id, {
          method: 'PATCH',
          body: { ...patch, version: source.version },
        });
      if (draftRef.current?.id === id) assign(row);
      setRefreshKey((n) => n + 1);
      refresh();
    } catch (e) {
      onError(e);
    }
  }
  async function setFavorite(id, favorite) {
    try {
      await api(`/notes/${id}/favorite`, { method: 'PUT', body: { favorite } });
      const apply = (n) => (n?.id === id ? { ...n, favorite } : n);
      if (draftRef.current?.id === id) {
        serverRef.current = apply(serverRef.current);
        draftRef.current = apply(draftRef.current);
        setDraft(draftRef.current);
      }
      setNotes((rows) => rows.map(apply));
      setRefreshKey((n) => n + 1);
      refresh();
    } catch (e) {
      onError(e);
    }
  }
  async function upload(file) {
    const note = draftRef.current;
    if (!note) throw new Error('请先打开一篇笔记');
    const form = new FormData();
    form.append('file', file);
    const item = await api(`/notes/${note.id}/attachments`, { method: 'POST', body: form });
    if (draftRef.current?.id === note.id) {
      attachmentEpoch.current++;
      const attachments = [...draftRef.current.attachments, item];
      draftRef.current = { ...draftRef.current, attachments };
      serverRef.current = { ...serverRef.current, attachments };
      setDraft(draftRef.current);
    }
    return item;
  }
  const showMenu = (event, items) => {
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu({
      id: Date.now(),
      items,
      position: {
        x: event.type === 'contextmenu' ? event.clientX : rect.left,
        y: event.type === 'contextmenu' ? event.clientY : rect.bottom + 4,
      },
    });
  };
  async function savedDialog(type) {
    if (!(await ensureSaved())) return;
    setDialog({ type });
  }
  // Settings never touch the open note, so unsaved edits only need to reach the local draft
  // (written by edit()) rather than the server.
  async function openSettings() {
    try {
      await editorRef.current?.flush();
    } catch {
      /* The last automatic snapshot is already in the local draft. */
    }
    setDialog({ type: 'settings' });
  }
  async function logout() {
    if (!(await ensureSaved())) return;
    try {
      await api('/auth/logout', { method: 'POST' });
      onLogout();
    } catch (e) {
      onError(e);
    }
  }
  async function exportNote(format) {
    if (!(await ensureSaved())) return;
    const row = draftRef.current;
    if (!row) return;
    const safeName = (row.title || '无标题笔记').replace(/[<>:"/\\|?*]/g, '_');
    if (format === 'word' || format === 'pdf') {
      try {
        await exportDocument(row, format, safeName);
      } catch (error) {
        onError(error);
      }
      return;
    }
    if (format === 'zip') {
      try {
        const response = await fetch('/api/notes/' + row.id + '/export/zip');
        if (!response.ok) throw new Error((await response.json()).error);
        download(safeName + '.zip', await response.blob(), 'application/zip');
      } catch (e) {
        onError(e);
      }
      return;
    }
    if (format === 'markdown') {
      const converter = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced' });
      download(
        safeName + '.md',
        row.type === 'markdown' ? row.content : converter.turndown(row.content),
      );
    }
    if (format === 'html') {
      const html = DOMPurify.sanitize(
        row.type === 'markdown' ? marked.parse(row.content) : row.content,
      );
      download(
        safeName + '.html',
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${row.title.replace(/[<>&]/g, '')}</title><body><h1>${row.title.replace(/[<>&]/g, '')}</h1>${html}</body></html>`,
        'text/html;charset=utf-8',
      );
    }
    if (format === 'text')
      download(
        safeName + '.txt',
        row.title +
          '\n\n' +
          (row.type === 'markdown'
            ? row.content
            : new DOMParser().parseFromString(row.content, 'text/html').body.textContent),
      );
  }
  const noteMenu = (row) =>
    row.deleted_at
      ? [
          {
            icon: RotateCcw,
            label: '恢复笔记',
            action: () => mutateNote(row.id, { deleted_at: null }),
          },
          {
            icon: Trash2,
            label: '永久删除',
            danger: true,
            action: () =>
              setDialog({
                type: 'confirm',
                title: '永久删除笔记',
                description: '此操作将删除笔记、附件及历史版本，无法恢复。',
                action: async () => {
                  await api('/notes/' + row.id, { method: 'DELETE' });
                  setRefreshKey((n) => n + 1);
                  refresh();
                },
              }),
          },
        ]
      : [
          {
            icon: Star,
            label: row.favorite ? '取消收藏' : '添加到收藏',
            action: () => setFavorite(row.id, !row.favorite),
          },
          {
            icon: Pin,
            label: row.pinned ? '取消置顶' : '置顶笔记',
            action: () => mutateNote(row.id, { pinned: !row.pinned }),
          },
          {
            icon: FolderInput,
            label: '移动到文件夹…',
            action: async () => {
              if (!(await openNote(row.id))) return;
              setDialog({ type: 'move' });
            },
          },
          {
            icon: Copy,
            label: '创建副本',
            action: async () => {
              if (!(await ensureSaved())) return;
              try {
                const copied = await api(`/notes/${row.id}/duplicate`, { method: 'POST' });
                assign(copied);
                setRefreshKey((n) => n + 1);
                refresh();
                notify('已创建副本');
              } catch (e) {
                onError(e);
              }
            },
          },
          { separator: true },
          {
            icon: HistoryIcon,
            label: '历史版本',
            action: async () => {
              if (!(await openNote(row.id))) return;
              savedDialog('history');
            },
          },
          {
            icon: Share2,
            label: '链接分享',
            action: async () => {
              if (!(await openNote(row.id))) return;
              savedDialog('share');
            },
          },
          { separator: true },
          {
            icon: Trash2,
            label: '移到回收站',
            danger: true,
            action: () => mutateNote(row.id, { deleted_at: true }),
          },
        ];
  function folderMenu(row) {
    return [
      { icon: Plus, label: '新建子文件夹', action: () => newFolder(row.id) },
      {
        icon: Folder,
        label: '重命名',
        action: () =>
          setDialog({
            type: 'prompt',
            title: '重命名文件夹',
            label: '文件夹名称',
            initial: row.name,
            action: async (name) => {
              await api('/folders/' + row.id, { method: 'PATCH', body: { name } });
              await refresh();
            },
          }),
      },
      {
        icon: FolderInput,
        label: '移动文件夹',
        action: () => setDialog({ type: 'moveFolder', folder: row }),
      },
      {
        icon: Trash2,
        label: '删除文件夹',
        danger: true,
        action: () =>
          setDialog({
            type: 'confirm',
            title: '删除文件夹',
            description: '笔记和子文件夹将移动到上一级，内容会保留。',
            action: async () => {
              if (!(await ensureSaved())) throw new Error('请先保存当前笔记');
              await api('/folders/' + row.id, { method: 'DELETE' });
              if (draftRef.current) assign(await api('/notes/' + draftRef.current.id));
              await refresh();
              setScope({ view: 'all' });
              setRefreshKey((k) => k + 1);
            },
          }),
      },
    ];
  }
  function newFolder(parent_id = null) {
    setDialog({
      type: 'prompt',
      title: parent_id ? '新建子文件夹' : '新建文件夹',
      label: '文件夹名称',
      action: async (name) => {
        await api('/folders', { method: 'POST', body: { name, parent_id } });
        if (parent_id) setExpanded((s) => ({ ...s, [parent_id]: true }));
        await refresh();
      },
    });
  }
  function tagMenu(tag) {
    return [
      {
        label: '重命名标签',
        action: () =>
          setDialog({
            type: 'prompt',
            title: '重命名标签',
            label: '标签名称',
            initial: tag.name,
            action: async (name) => {
              await api('/tags/' + tag.id, { method: 'PATCH', body: { name } });
              await refresh();
              setRefreshKey((k) => k + 1);
            },
          }),
      },
      {
        label: '删除标签',
        danger: true,
        action: () =>
          setDialog({
            type: 'confirm',
            title: '删除标签',
            description: '笔记内容会保留，标签关联将被移除。',
            action: async () => {
              if (!(await ensureSaved())) throw new Error('请先保存当前笔记');
              await api('/tags/' + tag.id, { method: 'DELETE' });
              await refresh();
              if (draftRef.current) assign(await api('/notes/' + draftRef.current.id));
              setScope({ view: 'all' });
              setRefreshKey((k) => k + 1);
            },
          }),
      },
    ];
  }
  const renderFolders = (parent = null, depth = 0) =>
    boot.folders
      .filter((f) => f.parent_id === parent)
      .map((f) => {
        const children = boot.folders.some((c) => c.parent_id === f.id),
          isOpen = expanded[f.id],
          active = scope.folder === f.id;
        return (
          <React.Fragment key={f.id}>
            <div
              className={'folder-row nav-row ' + (active ? 'selected' : '')}
              style={{ paddingLeft: 6 + depth * 14 }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('folder', f.id);
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                try {
                  const id = e.dataTransfer.getData('note'),
                    folderId = e.dataTransfer.getData('folder');
                  if (id) await mutateNote(id, { folder_id: f.id });
                  else if (folderId) {
                    await api('/folders/' + folderId, {
                      method: 'PATCH',
                      body: { parent_id: f.id },
                    });
                    await refresh();
                  }
                  setExpanded((s) => ({ ...s, [f.id]: true }));
                } catch (e) {
                  onError(e);
                }
              }}
              onContextMenu={(e) => showMenu(e, folderMenu(f))}
            >
              <button
                className="tree-toggle"
                aria-label={(isOpen ? '折叠' : '展开') + f.name}
                onClick={() => setExpanded((s) => ({ ...s, [f.id]: !isOpen }))}
              >
                {children ? (
                  <ChevronRight size={13} className={'chevron' + (isOpen ? ' open' : '')} />
                ) : null}
              </button>
              <button
                className="folder-select"
                onClick={() => changeScope({ view: 'all', folder: f.id })}
              >
                {active ? <FolderOpen size={16} /> : <Folder size={16} />}
                <span>{f.name}</span>
              </button>
              <button
                className="nav-more"
                aria-label={f.name + '菜单'}
                onClick={(e) => showMenu(e, folderMenu(f))}
              >
                <MoreHorizontal size={15} />
              </button>
            </div>
            {children && <Collapse open={isOpen}>{renderFolders(f.id, depth + 1)}</Collapse>}
          </React.Fragment>
        );
      });
  function resize(event, key, min, max) {
    event.preventDefault();
    const start = event.clientX,
      width = panelWidths[key];
    const move = (e) =>
      setPanelWidths((s) => ({
        ...s,
        [key]: Math.min(max, Math.max(min, width + e.clientX - start)),
      }));
    // Size transitions would make dragging lag behind the pointer.
    document.body.classList.add('pane-resizing');
    const up = () => {
      document.body.classList.remove('pane-resizing');
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }
  if (sidePanel && sidePanel !== lastPanel) setLastPanel(sidePanel);
  const shownPanel = sidePanel || lastPanel;
  if (!boot)
    return (
      <div className="boot-screen">
        <Loader2 className="spin" />
        <p>正在加载笔记…</p>
        {toast && <p className="error-text">{toast.message}</p>}
      </div>
    );
  const currentFolder = boot.folders.find((f) => f.id === scope.folder),
    currentTag = boot.tags.find((t) => t.id === scope.tag);
  const title = search
    ? '搜索结果'
    : currentFolder?.name ||
      currentTag?.name ||
      { all: '个人笔记', favorites: '我的收藏', trash: '回收站' }[scope.view];
  const breadcrumbs = [];
  let f = boot.folders.find((f) => f.id === draft?.folder_id);
  while (f) {
    breadcrumbs.unshift(f);
    f = boot.folders.find((p) => p.id === f.parent_id);
  }
  const deleted = !!draft?.deleted_at;
  return (
    <div
      className={`workspace ${focus ? 'focus-mode' : ''} ${navigation ? '' : 'nav-hidden'} mobile-${mobilePane}`}
      style={{
        '--left-width': panelWidths.left + 'px',
        '--middle-width': panelWidths.middle + 'px',
      }}
    >
      <aside className="sidebar" inert={!navigation && mobilePane !== 'nav'}>
        <div className="account-row">
          <button
            className="account-button"
            onClick={(e) =>
              showMenu(e, [
                { icon: SettingsIcon, label: '设置', action: openSettings },
                { icon: LogOut, label: '退出登录', action: logout },
              ])
            }
          >
            <span className="avatar">{boot.user.name.slice(0, 1).toUpperCase()}</span>
            <span>{boot.user.name}</span>
            <ChevronDown size={14} />
          </button>
          <IconButton
            icon={PanelLeftClose}
            label="收起导航栏"
            onClick={() => setNavigation(false)}
          />
        </div>

        <div className="sidebar-scroll">
          <nav className="main-nav">
            <div
              className={
                'nav-row all-notes ' +
                (scope.view === 'all' && !scope.folder && !scope.tag ? 'selected' : '')
              }
            >
              <button
                aria-label="个人笔记"
                className="all-notes-select"
                onClick={() => changeScope({ view: 'all' })}
              >
                <FileText size={16} />
                <span>所有笔记</span>
              </button>
            </div>
            <button
              className={'nav-row ' + (scope.view === 'favorites' ? 'selected' : '')}
              onClick={() => changeScope({ view: 'favorites' })}
            >
              <Star size={16} />
              <span>我的收藏</span>
              <small>{boot.counts.favorites || ''}</small>
            </button>
          </nav>
          <div className="nav-section">
            <button
              aria-label="折叠或展开个人笔记目录"
              onClick={() => setFoldersOpen(!foldersOpen)}
            >
              <span>文件夹</span>
              <ChevronRight size={12} className={'chevron' + (foldersOpen ? ' open' : '')} />
            </button>
            <button aria-label="新建文件夹" title="新建文件夹" onClick={() => newFolder()}>
              <Plus size={14} />
            </button>
          </div>
          <Collapse open={foldersOpen}>
            <nav className="folder-tree">
              {boot.folders.length ? (
                renderFolders()
              ) : (
                <span className="nav-empty">新建文件夹来整理笔记</span>
              )}
            </nav>
          </Collapse>
          <div className="nav-section tag-section">
            <button aria-label="折叠或展开标签" onClick={() => setTagsOpen(!tagsOpen)}>
              <span>标签</span>
              <ChevronRight size={12} className={'chevron' + (tagsOpen ? ' open' : '')} />
            </button>
            <button
              aria-label="新建标签"
              title="新建标签"
              onClick={() =>
                setDialog({
                  type: 'prompt',
                  title: '新建标签',
                  label: '标签名称',
                  action: async (name) => {
                    await api('/tags', { method: 'POST', body: { name } });
                    await refresh();
                  },
                })
              }
            >
              <Plus size={14} />
            </button>
          </div>
          <Collapse open={tagsOpen}>
            <nav className="tags-nav">
              {boot.tags.length ? (
                boot.tags.map((t) => (
                  <div
                    key={t.id}
                    className={'nav-row ' + (scope.tag === t.id ? 'selected' : '')}
                    onContextMenu={(e) => showMenu(e, tagMenu(t))}
                  >
                    <button onClick={() => changeScope({ view: 'all', tag: t.id })}>
                      <Hash size={14} />
                      <span>{t.name}</span>
                    </button>
                    <button
                      className="nav-more"
                      aria-label={t.name + '标签菜单'}
                      onClick={(e) => showMenu(e, tagMenu(t))}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                ))
              ) : (
                <span className="nav-empty">用标签连接你的想法</span>
              )}
            </nav>
          </Collapse>
        </div>
        <div className="sidebar-footer">
          <button
            className={'nav-row ' + (scope.view === 'trash' ? 'selected' : '')}
            onClick={() => changeScope({ view: 'trash' })}
          >
            <Trash2 size={16} />
            <span>回收站</span>
            {boot.trash > 0 && <small>{boot.trash}</small>}
          </button>
        </div>
      </aside>
      <div
        className="pane-resizer left-resizer"
        onPointerDown={(e) => resize(e, 'left', 160, 320)}
      />
      <section className="note-list-panel">
        <div className="search-row">
          {!navigation && (
            <IconButton icon={PanelLeft} label="展开导航栏" onClick={() => setNavigation(true)} />
          )}
          <button
            className="mobile-menu icon-button"
            aria-label="打开导航栏"
            onClick={() => setMobilePane('nav')}
          >
            <Menu size={19} />
          </button>
          <label className="search-box">
            <Search size={16} />
            <input
              ref={searchInput}
              aria-label="搜索笔记"
              placeholder="搜索笔记"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button title="清除搜索" aria-label="清除搜索" onClick={() => setQuery('')}>
                <X size={13} />
              </button>
            ) : (
              <kbd>{/Mac/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd>
            )}
          </label>
          <div className="new-note-row">
            <button
              className="new-note"
              aria-label="新建笔记"
              title={'新建笔记 (' + (/Mac/.test(navigator.platform) ? '⌘ N' : 'Ctrl N') + ')'}
              onClick={() => createNote()}
            >
              <Plus size={16} />
              <span>新建</span>
            </button>
            <button
              className="new-note-select"
              aria-label="选择笔记类型"
              onClick={(e) =>
                showMenu(e, [
                  { icon: FileText, label: '新建笔记', action: () => createNote() },
                  {
                    icon: ListTree,
                    label: '新建大纲笔记',
                    action: () => createNote(outlineTemplate),
                  },
                  { separator: true },
                  {
                    icon: Upload,
                    label: '导入 Markdown 文件…',
                    action: () => importInput.current.click(),
                  },
                  {
                    icon: BookOpen,
                    label: '从模板新建…',
                    action: () => setDialog({ type: 'templates' }),
                  },
                ])
              }
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
        <div className="list-heading">
          <div>
            <h1>{title}</h1>
            <span>{notes.length} 篇笔记</span>
          </div>
          <IconButton
            icon={ArrowDownWideNarrow}
            label="排序与视图"
            onClick={(e) =>
              showMenu(e, [
                ...Object.entries({
                  updated: '按编辑时间',
                  created: '按创建时间',
                  title: '按标题',
                }).map(([value, label]) => ({
                  label: (sort === value ? '✓ ' : '') + label,
                  action: () => setSort(value),
                })),
                { separator: true },
                {
                  label: direction === 'desc' ? '改为升序' : '改为降序',
                  action: () => setDirection((d) => (d === 'desc' ? 'asc' : 'desc')),
                },
                {
                  label: boot.settings.listView === 'compact' ? '摘要视图' : '紧凑视图',
                  action: async () => {
                    try {
                      await api('/settings', {
                        method: 'PUT',
                        body: {
                          listView: boot.settings.listView === 'compact' ? 'detail' : 'compact',
                        },
                      });
                      refresh();
                    } catch (e) {
                      onError(e);
                    }
                  },
                },
              ])
            }
          />
        </div>
        {scope.view === 'trash' && notes.length > 0 && (
          <button
            className="empty-trash"
            onClick={() =>
              setDialog({
                type: 'confirm',
                title: '清空回收站',
                description: '回收站中的全部笔记及附件将永久删除，无法恢复。',
                action: async () => {
                  await api('/trash', { method: 'DELETE' });
                  setRefreshKey((k) => k + 1);
                  refresh();
                },
              })
            }
          >
            清空回收站
          </button>
        )}
        <div
          className={'notes-list ' + (boot.settings.listView === 'compact' ? 'compact' : '')}
          aria-label="笔记列表"
        >
          {listLoading ? (
            <div className="list-empty">
              <Loader2 className="spin" size={23} />
              <p>正在加载…</p>
            </div>
          ) : notes.length ? (
            notes.map((n) => (
              <div
                role="button"
                tabIndex={0}
                aria-label={'打开笔记 ' + n.title}
                key={n.id}
                className={'note-card ' + (draft?.id === n.id ? 'selected' : '')}
                onClick={() => openNote(n.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openNote(n.id);
                }}
                onContextMenu={(e) => showMenu(e, noteMenu(n))}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('note', n.id)}
              >
                <div className="note-card-title">
                  {n.pinned && <Pin size={12} />}
                  <strong>{n.title || '无标题笔记'}</strong>
                  {n.favorite && <Star size={13} className="favorite-star" />}
                  <button
                    className="card-menu"
                    aria-label={n.title + '笔记菜单'}
                    onClick={(e) => showMenu(e, noteMenu(n))}
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </div>
                <p className="note-excerpt">
                  {n.excerpt?.replace(/[#*`>]/g, '').trim() || '暂无内容'}
                </p>
                <div className="note-card-meta">
                  <time>{date(n.updated_at)}</time>
                  <span>
                    {n.type === 'markdown' ? (
                      'M↓'
                    ) : n.type === 'outline' ? (
                      <ListTree size={13} />
                    ) : null}
                    {n.attachment_count > 0 && <Paperclip size={12} />}
                  </span>
                </div>
                {n.tags.length > 0 && (
                  <div className="card-tags">
                    {n.tags.slice(0, 3).map((t) => (
                      <span key={t.id}>{t.name}</span>
                    ))}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="list-empty">
              <FileText size={36} />
              <p>
                {search
                  ? '未搜索到笔记'
                  : scope.view === 'trash'
                    ? '回收站空空如也'
                    : scope.view === 'favorites'
                      ? '没有收藏的笔记'
                      : '这里还没有笔记'}
              </p>
              {scope.view === 'all' && !search && (
                <button onClick={() => createNote()}>新建第一篇笔记</button>
              )}
            </div>
          )}
        </div>
        <div className="list-footer">
          <Check size={12} /> 数据已同步
          <IconButton
            icon={RefreshCw}
            label="同步笔记"
            onClick={() => {
              setRefreshKey((k) => k + 1);
              refresh();
            }}
          />
        </div>
      </section>
      <div
        className="pane-resizer middle-resizer"
        onPointerDown={(e) => resize(e, 'middle', 220, 700)}
      />
      <main
        className={'note-panel' + (draft && sidePanel ? ' has-details' : '')}
        style={{ '--body-size': (boot.settings.fontSize || 16) + 'px' }}
      >
        {draft ? (
          <>
            <header className="note-topbar">
              <button
                className="mobile-back icon-button"
                aria-label="返回笔记列表"
                onClick={async () => {
                  if (await ensureSaved()) setMobilePane('list');
                }}
              >
                <ArrowLeft size={18} />
              </button>
              {focus && (
                <IconButton icon={PanelLeft} label="退出专注模式" onClick={() => setFocus(false)} />
              )}
              <div className="breadcrumb">
                <Folder size={14} />
                {breadcrumbs.length ? (
                  breadcrumbs.map((f, i) => (
                    <React.Fragment key={f.id}>
                      {i > 0 && <ChevronRight size={12} />}
                      <button onClick={() => changeScope({ view: 'all', folder: f.id })}>
                        {f.name}
                      </button>
                    </React.Fragment>
                  ))
                ) : (
                  <span>个人笔记</span>
                )}
              </div>
              <span className="spacer" />
              <div
                className={'save-state ' + saveStatus}
                title={
                  saveStatus === 'conflict'
                    ? '请导出当前笔记后重新载入，防止丢失编辑'
                    : '点击保存图标或按 Ctrl / ⌘ + S 保存'
                }
              >
                {saveStatus === 'saving' ? (
                  <Loader2 size={13} className="spin" />
                ) : saveStatus === 'error' || saveStatus === 'conflict' ? (
                  <AlertCircle size={13} />
                ) : (
                  <Check size={13} />
                )}
                <span>
                  {
                    {
                      saved: <SavedTime value={draft.updated_at} />,
                      dirty: '待保存',
                      saving: '保存中',
                      error: '保存失败',
                      conflict: '版本冲突',
                    }[saveStatus]
                  }
                </span>
              </div>
              <IconButton
                icon={editing ? Save : Pencil}
                label={editing ? '保存笔记' : '编辑笔记'}
                disabled={deleted || saveStatus === 'saving'}
                active={saveStatus === 'dirty'}
                onClick={async () => {
                  if (editing) {
                    if (await flush()) setEditing(false);
                  } else setEditing(true);
                }}
              />
              <IconButton
                icon={Info}
                label="笔记详细信息"
                active={sidePanel === 'info'}
                onClick={() => setSidePanel(sidePanel === 'info' ? null : 'info')}
              />
              <IconButton
                icon={Star}
                label={draft.favorite ? '取消收藏' : '收藏笔记'}
                active={draft.favorite}
                disabled={deleted}
                onClick={() => setFavorite(draft.id, !draft.favorite)}
              />
              <IconButton
                icon={Share2}
                label="分享笔记"
                disabled={deleted}
                onClick={() => savedDialog('share')}
              />
              <IconButton
                icon={MoreHorizontal}
                label="笔记更多操作"
                onClick={(e) =>
                  showMenu(e, [
                    ...noteMenu(draft),
                    { separator: true },
                    {
                      icon: MessageSquare,
                      label: '评论',
                      disabled: deleted,
                      action: () => savedDialog('comments'),
                    },
                    { icon: Download, label: '导出为 Word', action: () => exportNote('word') },
                    { icon: Download, label: '导出为 PDF', action: () => exportNote('pdf') },
                    {
                      icon: Download,
                      label: '导出为 Markdown',
                      action: () => exportNote('markdown'),
                    },
                    { icon: Download, label: '导出为 HTML', action: () => exportNote('html') },
                    { icon: Download, label: '导出为纯文本', action: () => exportNote('text') },
                    {
                      icon: focus ? Minimize2 : Maximize2,
                      label: focus ? '退出专注模式' : '专注模式',
                      action: () => setFocus(!focus),
                    },
                  ])
                }
              />
            </header>
            {(saveStatus === 'error' || saveStatus === 'conflict') && (
              <div className="save-error" role="alert">
                <AlertCircle size={15} />
                <span>
                  {saveStatus === 'conflict'
                    ? '此笔记在其他窗口有更新，当前编辑尚未保存。'
                    : `无法保存：${saveError}`}
                </span>
                {saveStatus === 'error' && <button onClick={() => flush()}>重试</button>}
                <button
                  onClick={() =>
                    download(
                      (draft.title || '未保存笔记') +
                        '.' +
                        (draft.type === 'markdown' ? 'md' : 'html'),
                      draft.content,
                    )
                  }
                >
                  导出当前内容
                </button>
                <button
                  onClick={() =>
                    setDialog({
                      type: 'confirm',
                      title: '重新载入笔记',
                      description: '未保存的修改将被丢弃，请先导出当前内容。',
                      action: async () => {
                        assign(await api('/notes/' + draft.id));
                      },
                    })
                  }
                >
                  重新载入
                </button>
              </div>
            )}
            {deleted && (
              <div className="trash-banner">
                <Trash2 size={15} />
                <span>此笔记已移到回收站</span>
                <button onClick={() => mutateNote(draft.id, { deleted_at: null })}>恢复笔记</button>
              </div>
            )}
            <div className="note-title-area">
              <input
                className="note-title"
                aria-label="笔记标题"
                value={draft.title}
                readOnly={deleted || !editing}
                placeholder="无标题笔记"
                maxLength={500}
                onChange={(e) => edit({ title: e.target.value })}
              />
            </div>
            <div className="note-body">
              <div className="editor-area">
                <NoteEditor
                  key={draft.id + ':' + resetKey}
                  note={draft}
                  onChange={(patch) => {
                    nativeDirtyRef.current = false;
                    edit(patch);
                  }}
                  onDirty={(dirty) => {
                    nativeDirtyRef.current = dirty;
                    if (dirty) setSaveStatus('dirty');
                  }}
                  theme={boot.settings.theme || 'light'}
                  onUpload={upload}
                  readOnly={deleted || !editing}
                  editorRef={editorRef}
                  fontSize={boot.settings.fontSize || 16}
                  onError={onError}
                />
                {draft.attachments.length > 0 && (
                  <div className="attachments-strip">
                    <span>
                      <Paperclip size={14} /> 附件 ({draft.attachments.length})
                    </span>
                    <div>
                      {draft.attachments.map((a) => (
                        <div className="attachment" key={a.id}>
                          <a href={'/files/' + a.id} target="_blank" rel="noreferrer">
                            <FileText size={17} />
                            <span>
                              {a.name}
                              <small>{bytes(a.size)}</small>
                            </span>
                            <Download size={13} />
                          </a>
                          {!deleted && (
                            <button
                              aria-label={'删除附件 ' + a.name}
                              onClick={() =>
                                setDialog({
                                  type: 'confirm',
                                  title: '删除附件',
                                  description: '删除后正文中引用此附件的链接将失效。',
                                  action: async () => {
                                    await api('/attachments/' + a.id, { method: 'DELETE' });
                                    attachmentEpoch.current++;
                                    const attachments = draftRef.current.attachments.filter(
                                      (f) => f.id !== a.id,
                                    );
                                    draftRef.current = { ...draftRef.current, attachments };
                                    serverRef.current = { ...serverRef.current, attachments };
                                    setDraft(draftRef.current);
                                  },
                                })
                              }
                            >
                              <X size={12} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {shownPanel && (
                <aside className={'detail-panel' + (sidePanel ? ' open' : '')} inert={!sidePanel}>
                  <header>
                    <strong>笔记信息</strong>
                    <IconButton icon={X} label="关闭侧栏" onClick={() => setSidePanel(null)} />
                  </header>
                  <div className="note-info">
                    {[
                      ['创建时间', date(draft.created_at)],
                      ['编辑时间', date(draft.updated_at)],
                      ['作者', boot.user.name],
                      [
                        '类型',
                        { common: '富文本笔记', markdown: 'Markdown', outline: '大纲笔记' }[
                          draft.type
                        ],
                      ],
                      ['版本', 'v' + draft.version],
                      [
                        '字数',
                        (draft.type === 'markdown'
                          ? draft.content
                          : new DOMParser().parseFromString(draft.content, 'text/html').body
                              .textContent
                        ).replace(/\s/g, '').length,
                      ],
                      ['附件', draft.attachments.length + ' 个'],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{value}</strong>
                      </div>
                    ))}
                    <button className="secondary" onClick={() => savedDialog('history')}>
                      <HistoryIcon size={15} /> 查看历史版本
                    </button>
                  </div>
                </aside>
              )}
            </div>
          </>
        ) : (
          <div className="empty-editor">
            <FileText size={64} strokeWidth={1} />
            <h2>记录每一个值得留下的想法</h2>
            <p>选择一篇笔记，或开始新的记录</p>
            <button className="primary" onClick={() => createNote()}>
              <Plus size={17} />
              新建笔记
            </button>
            <button className="text-button" onClick={() => setDialog({ type: 'templates' })}>
              从模板开始
            </button>
          </div>
        )}
      </main>
      <input
        ref={importInput}
        aria-label="Markdown 文件"
        hidden
        type="file"
        accept=".md,.markdown"
        multiple
        onChange={async (e) => {
          const files = [...e.target.files];
          e.target.value = '';
          if (!files.length || !(await ensureSaved())) return;
          try {
            let last;
            for (const file of files) {
              if (file.size > 10 * 1024 * 1024) throw new Error('正文导入文件不能超过 10MB');
              last = await api('/notes', {
                method: 'POST',
                body: {
                  title: file.name.replace(/\.(md|markdown)$/i, '') || '无标题笔记',
                  content: await file.text(),
                  type: 'markdown',
                  folder_id: scope.folder || boot.folders[0]?.id || null,
                  tags: scope.tag ? [scope.tag] : [],
                },
              });
            }
            assign(last);
            setScope({ view: 'all' });
            setRefreshKey((k) => k + 1);
            refresh();
            setMobilePane('note');
            notify(`已导入 ${files.length} 篇 Markdown 笔记`);
          } catch (error) {
            onError(error);
          }
        }}
      />
      {menu && (
        <Dropdown
          key={menu.id}
          items={menu.items}
          position={menu.position}
          onClose={() => setMenu(null)}
        />
      )}
      {dialog?.type === 'settings' && (
        <Settings
          bootstrap={boot}
          onClose={() => setDialog(null)}
          onChanged={async () => {
            await refresh();
            setRefreshKey((k) => k + 1);
          }}
          onLogout={logout}
          onError={onError}
        />
      )}
      {dialog?.type === 'history' && draft && (
        <History
          note={draft}
          onClose={() => setDialog(null)}
          onRestored={(row) => {
            assign(row);
            setRefreshKey((k) => k + 1);
            notify('历史版本已恢复');
          }}
          onError={onError}
        />
      )}
      {dialog?.type === 'share' && draft && (
        <ShareDialog
          note={draft}
          onClose={() => setDialog(null)}
          onUpdated={(token) => {
            draftRef.current = { ...draftRef.current, share_token: token };
            serverRef.current = { ...serverRef.current, share_token: token };
            setDraft(draftRef.current);
          }}
          onError={onError}
        />
      )}
      {dialog?.type === 'comments' && draft && (
        <Comments note={draft} onClose={() => setDialog(null)} onError={onError} />
      )}
      {(dialog?.type === 'prompt' || dialog?.type === 'confirm') && (
        <PromptDialog
          title={dialog.title}
          label={dialog.label}
          initial={dialog.initial}
          description={dialog.description}
          danger={dialog.type === 'confirm'}
          onSubmit={dialog.action}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.type === 'templates' && (
        <Modal title="从模板新建笔记" onClose={() => setDialog(null)} wide>
          <div className="template-grid">
            {templates.map((t) => (
              <button key={t.id} className="template-card" onClick={() => createNote(t)}>
                <div className={'template-thumb template-' + t.id}>
                  <FileText size={30} strokeWidth={1} />
                  <span>{t.name}</span>
                  <i />
                  <i />
                  <i />
                </div>
                <strong>{t.name}</strong>
                <p>{t.description}</p>
              </button>
            ))}
          </div>
        </Modal>
      )}
      {(dialog?.type === 'move' || dialog?.type === 'moveFolder') && (
        <MoveDialog
          folders={boot.folders}
          initial={dialog.folder?.parent_id || draft?.folder_id}
          movingFolder={dialog.folder}
          onClose={() => setDialog(null)}
          onMove={async (id) => {
            if (dialog.type === 'moveFolder') {
              await api('/folders/' + dialog.folder.id, {
                method: 'PATCH',
                body: { parent_id: id },
              });
              await refresh();
            } else if (draftRef.current) {
              await mutateNote(draftRef.current.id, { folder_id: id });
            }
            setDialog(null);
          }}
        />
      )}
      {toast && (
        <div className={'toast ' + toast.type} role={toast.type === 'error' ? 'alert' : 'status'}>
          {toast.type === 'error' ? <AlertCircle size={17} /> : <Check size={17} />}
          <span>{toast.message}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={13} />
          </button>
        </div>
      )}
      {mobilePane === 'nav' && (
        <button
          className="mobile-nav-overlay"
          aria-label="关闭导航栏"
          onClick={() => setMobilePane('list')}
        />
      )}
    </div>
  );
}
function MoveDialog({ folders, initial, movingFolder, onMove, onClose }) {
  const [target, setTarget] = useState(initial || ''),
    [err, setErr] = useState(''),
    [busy, setBusy] = useState(false);
  const excluded = new Set(movingFolder ? [movingFolder.id] : []);
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of folders)
      if (f.parent_id && excluded.has(f.parent_id) && !excluded.has(f.id)) {
        excluded.add(f.id);
        changed = true;
      }
  }
  const label = (f) => {
    const names = [f.name];
    let p = f.parent_id;
    while (p) {
      const parent = folders.find((x) => x.id === p);
      if (!parent) break;
      names.unshift(parent.name);
      p = parent.parent_id;
    }
    return names.join(' / ');
  };
  return (
    <Modal title={movingFolder ? '移动文件夹' : '移动笔记'} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onMove(target || null);
          } catch (e) {
            setErr(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          目标文件夹
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">个人笔记 / 根目录</option>
            {folders
              .filter((f) => !excluded.has(f.id))
              .map((f) => (
                <option key={f.id} value={f.id}>
                  {label(f)}
                </option>
              ))}
          </select>
        </label>
        {err && <p className="error-text">{err}</p>}
        <footer>
          <button className="secondary" type="button" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            移动
          </button>
        </footer>
      </form>
    </Modal>
  );
}
