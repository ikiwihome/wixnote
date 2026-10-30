import { useCallback, useEffect, useRef, useState } from 'react';
import {
  X,
  Check,
  Download,
  Upload,
  User,
  Palette,
  Keyboard,
  Database,
  History as HistoryIcon,
  Link2,
  Copy,
  KeyRound,
} from 'lucide-react';
import { api, download, date, timeAgo } from './api.js';
import NoteEditor from './Editor.jsx';

export function SavedTime({ value }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, [value]);
  // Anything saved within the last minute reads as "just now" rather than a ticking second count.
  const recent = now - new Date(value).getTime() < 60000;
  return (
    <time dateTime={value} title={date(value)}>
      {recent ? '保存于刚刚' : `保存于 ${timeAgo(value, now)}`}
    </time>
  );
}

export function IconButton({ icon: Icon, label, onClick, active, disabled, className = '' }) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''} ${className}`}
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={18} />
    </button>
  );
}
export function Switch({ checked, label, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      className="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}
export function Modal({ title, children, onClose, wide = false }) {
  const panel = useRef(),
    previousFocus = useRef(document.activeElement),
    closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const restoreFocus = previousFocus.current;
    const first = panel.current?.querySelector('input,button,select,textarea');
    first?.focus();
    const handler = (e) => {
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab') {
        const els = [
          ...panel.current.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]'),
        ].filter((e) => !e.disabled && e.getClientRects().length);
        const first = els[0],
          last = els.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => {
      document.removeEventListener('keydown', handler);
      restoreFocus?.focus();
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={'modal ' + (wide ? 'wide' : '')}
      >
        <header>
          <h2>{title}</h2>
          <IconButton icon={X} label="关闭对话框" onClick={onClose} />
        </header>
        {children}
      </section>
    </div>
  );
}
export function PromptDialog({
  title,
  label,
  initial = '',
  onSubmit,
  onClose,
  danger = false,
  description,
}) {
  const [value, setValue] = useState(initial),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await onSubmit(value.trim());
            onClose();
          } catch (err) {
            setErr(err.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {description && <p className="muted">{description}</p>}
        {label && (
          <label className="field">
            {label}
            <input
              autoFocus
              required
              maxLength={100}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        {err && (
          <p className="error-text" role="alert">
            {err}
          </p>
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button
            className={danger ? 'danger primary' : 'primary'}
            disabled={busy || (!!label && !value.trim())}
          >
            {busy ? '处理中…' : '确定'}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export function Collapse({ open, children }) {
  return (
    <div className={'collapse' + (open ? ' open' : '')} inert={!open}>
      <div className="collapse-inner">{children}</div>
    </div>
  );
}
export function Dropdown({ items, position, onClose }) {
  const ref = useRef(),
    closeRef = useRef(onClose),
    timer = useRef();
  const [leaving, setLeaving] = useState(false);
  closeRef.current = onClose;
  // Play the exit animation before the parent unmounts the menu.
  const dismiss = useCallback(() => {
    if (timer.current) return;
    setLeaving(true);
    timer.current = setTimeout(() => closeRef.current(), 120);
  }, []);
  useEffect(() => {
    const close = (e) => {
      if (!ref.current?.contains(e.target)) dismiss();
    };
    const key = (e) => {
      if (e.key === 'Escape') dismiss();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', key);
    return () => {
      clearTimeout(timer.current);
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', key);
    };
  }, [dismiss]);
  const top = Math.max(8, Math.min(position.y, window.innerHeight - items.length * 35 - 16)),
    left = Math.max(8, Math.min(position.x, window.innerWidth - 230));
  return (
    <div
      ref={ref}
      role="menu"
      className={'dropdown' + (leaving ? ' leaving' : '')}
      inert={leaving}
      aria-hidden={leaving || undefined}
      style={{
        top,
        left,
        transformOrigin: `${left < position.x ? 'right' : 'left'} ${top < position.y ? 'bottom' : 'top'}`,
      }}
    >
      {items.map((item, i) =>
        item.separator ? (
          <hr key={i} />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={item.danger ? 'danger-text' : ''}
            disabled={item.disabled}
            onClick={() => {
              dismiss();
              item.action();
            }}
          >
            {item.icon && <item.icon size={16} />}
            <span>{item.label}</span>
            {item.hint && <small>{item.hint}</small>}
          </button>
        ),
      )}
    </div>
  );
}
export function Settings({ bootstrap, onClose, onChanged, onLogout, onDeleted, onError }) {
  const [tab, setTab] = useState('account'),
    [name, setName] = useState(bootstrap.user.name),
    [password, setPassword] = useState(''),
    [current, setCurrent] = useState(''),
    [deletePassword, setDeletePassword] = useState(''),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState(''),
    [keys, setKeys] = useState([]),
    [keyName, setKeyName] = useState(null),
    [newKey, setNewKey] = useState('');
  const input = useRef();
  const settings = bootstrap.settings;
  const setting = async (key, value) => {
    try {
      await api('/settings', { method: 'PUT', body: { [key]: value } });
      await onChanged();
    } catch (e) {
      onError(e);
    }
  };
  const tabs = [
    ['account', User, '账户信息'],
    ['appearance', Palette, '阅读与外观'],
    ['data', Database, '数据管理'],
    ['api', KeyRound, 'API Key'],
    ['shortcuts', Keyboard, '快捷键'],
  ];
  return (
    <Modal title="设置" onClose={onClose} wide>
      <div className="settings-layout">
        <nav>
          {tabs.map(([key, Icon, label]) => (
            <button
              key={key}
              className={tab === key ? 'selected' : ''}
              onClick={() => {
                setTab(key);
                setNotice('');
                setNewKey('');
                setKeyName(null);
                if (key === 'api') api('/api-keys').then(setKeys).catch(onError);
              }}
            >
              <Icon size={17} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === 'account' && (
            <>
              <h3>账户信息</h3>
              <p className="muted">{bootstrap.user.email}</p>
              {bootstrap.isAdmin && (
                <div className="data-action registration-toggle">
                  <div>
                    <strong>允许新用户注册</strong>
                    <p>关闭后登录页不再提供注册入口，已有账户不受影响</p>
                  </div>
                  <Switch
                    label="允许新用户注册"
                    checked={bootstrap.allowRegistration === true}
                    disabled={busy}
                    onChange={async (allowRegistration) => {
                      setBusy(true);
                      try {
                        await api('/registration', {
                          method: 'PUT',
                          body: { allowRegistration },
                        });
                        await onChanged();
                      } catch (e) {
                        onError(e);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  />
                </div>
              )}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  try {
                    await api('/account', {
                      method: 'PATCH',
                      body: { name, ...(password ? { password, currentPassword: current } : {}) },
                    });
                    await onChanged();
                    setNotice('账户信息已保存');
                    setPassword('');
                    setCurrent('');
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  昵称
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={100}
                  />
                </label>
                <h4>修改密码</h4>
                <label className="field">
                  当前密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                  />
                </label>
                <label className="field">
                  新密码
                  <input
                    type="password"
                    minLength={10}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="至少 10 位"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  保存更改
                </button>
              </form>
              <hr />
              <button className="secondary danger-text" onClick={onLogout}>
                退出登录
              </button>
              <hr />
              <h4>删除账户</h4>
              <p className="muted">
                将永久删除此账户及其全部笔记、文件夹、标签、附件和 API
                Key，且无法恢复。建议先在「数据管理」中导出完整备份。
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!window.confirm(`确定永久删除账户“${bootstrap.user.email}”及其全部数据？`))
                    return;
                  setBusy(true);
                  try {
                    await api('/account', {
                      method: 'DELETE',
                      body: { password: deletePassword },
                    });
                    onDeleted();
                  } catch (e) {
                    onError(e);
                    setBusy(false);
                  }
                }}
              >
                <label className="field">
                  当前密码
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={deletePassword}
                    onChange={(e) => setDeletePassword(e.target.value)}
                    required
                  />
                </label>
                <button className="danger primary" disabled={busy || !deletePassword}>
                  永久删除账户
                </button>
              </form>
            </>
          )}
          {tab === 'appearance' && (
            <>
              <h3>阅读与外观</h3>
              <label className="field">
                主题
                <select
                  aria-label="主题"
                  value={settings.theme || 'light'}
                  onChange={(e) => setting('theme', e.target.value)}
                >
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                  <option value="system">跟随系统</option>
                </select>
              </label>
              <label className="field">
                正文字号
                <select
                  aria-label="正文字号"
                  value={settings.fontSize || 16}
                  onChange={(e) => setting('fontSize', Number(e.target.value))}
                >
                  {[14, 16, 18, 20, 22].map((n) => (
                    <option key={n} value={n}>
                      {n} px
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                笔记列表
                <select
                  aria-label="笔记列表"
                  value={settings.listView || 'detail'}
                  onChange={(e) => setting('listView', e.target.value)}
                >
                  <option value="detail">摘要视图</option>
                  <option value="compact">紧凑视图</option>
                </select>
              </label>
            </>
          )}
          {tab === 'data' && (
            <>
              <h3>数据管理</h3>
              <p className="muted">
                完整备份包含文件夹、笔记、标签、历史版本、评论和附件。导入会追加数据，不会覆盖现有笔记。
              </p>
              <div className="data-action">
                <div>
                  <strong>导出完整备份</strong>
                  <p>ZIP 格式，包含至多 100 MB 附件</p>
                </div>
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const data = await api('/backup', { responseType: 'blob' });
                      download(
                        `wixnote-backup-${new Date().toISOString().slice(0, 10)}.zip`,
                        data,
                        'application/zip',
                      );
                      setNotice('备份已导出');
                    } catch (e) {
                      onError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Download size={16} /> 导出
                </button>
              </div>
              <div className="data-action">
                <div>
                  <strong>导入备份</strong>
                  <p>从本站导出的 ZIP 文件恢复</p>
                </div>
                <button className="secondary" disabled={busy} onClick={() => input.current.click()}>
                  <Upload size={16} /> 导入
                </button>
              </div>
              <input
                ref={input}
                hidden
                type="file"
                accept=".zip,application/zip"
                onChange={async (e) => {
                  const f = e.target.files[0];
                  if (!f) return;
                  setBusy(true);
                  try {
                    const result = await api('/import', {
                      method: 'POST',
                      body: f,
                    });
                    await onChanged();
                    setNotice(`已导入 ${result.imported} 篇笔记`);
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                    e.target.value = '';
                  }
                }}
              />
              <p className="muted small">大规模备份：停止服务后备份整个数据目录，详见 README。</p>
            </>
          )}
          {tab === 'api' && (
            <>
              <h3>API Key</h3>
              <p className="muted">密钥可通过 CLI 读取和修改当前账户的笔记，请妥善保管。</p>
              {keyName === null ? (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => {
                    setNewKey('');
                    setKeyName('default');
                  }}
                >
                  创建密钥
                </button>
              ) : (
                <form
                  className="key-name-form"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      const result = await api('/api-keys', {
                        method: 'POST',
                        body: { name: keyName.trim() },
                      });
                      setNewKey(result.token);
                      setKeyName(null);
                      setKeys(await api('/api-keys'));
                    } catch (error) {
                      onError(error);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="field">
                    密钥名称
                    <input
                      autoFocus
                      required
                      maxLength={100}
                      value={keyName}
                      onChange={(e) => setKeyName(e.target.value)}
                      onFocus={(e) => e.target.select()}
                    />
                  </label>
                  <button type="button" className="secondary" onClick={() => setKeyName(null)}>
                    取消
                  </button>
                  <button className="primary" disabled={busy || !keyName.trim()}>
                    创建
                  </button>
                </form>
              )}
              {newKey && (
                <div className="field">
                  <p>密钥仅显示一次，请立即复制保存。</p>
                  <input
                    aria-label="新建的 API Key"
                    readOnly
                    value={newKey}
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(newKey);
                        setNotice('密钥已复制');
                      } catch (error) {
                        onError(error);
                      }
                    }}
                  >
                    复制密钥
                  </button>
                </div>
              )}
              {keys.map((key) => (
                <div className="data-action" key={key.id}>
                  <div>
                    <strong>{key.name}</strong>
                    <p>创建于 {date(key.created_at)}</p>
                  </div>
                  <button
                    className="secondary danger-text"
                    disabled={busy}
                    onClick={async () => {
                      if (!window.confirm(`确定撤销密钥“${key.name}”？`)) return;
                      setBusy(true);
                      try {
                        await api('/api-keys/' + key.id, { method: 'DELETE' });
                        setKeys(await api('/api-keys'));
                        setNewKey('');
                      } catch (error) {
                        onError(error);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    撤销
                  </button>
                </div>
              ))}
              {!keys.length && <p className="muted">尚未创建密钥。</p>}
            </>
          )}
          {tab === 'shortcuts' && (
            <>
              <h3>快捷键</h3>
              {[
                ['新建笔记', 'Ctrl / ⌘ + N'],
                ['搜索笔记', 'Ctrl / ⌘ + K'],
                ['立即保存', 'Ctrl / ⌘ + S'],
                ['加粗', 'Ctrl / ⌘ + B'],
                ['斜体', 'Ctrl / ⌘ + I'],
                ['下划线', 'Ctrl / ⌘ + U'],
                ['关闭弹窗', 'Esc'],
              ].map(([name, key]) => (
                <div className="shortcut-row" key={name}>
                  <span>{name}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </>
          )}
          {notice && (
            <p className="success-text" role="status">
              <Check size={16} />
              {notice}
            </p>
          )}
          {busy && <p className="muted">正在处理…</p>}
        </div>
      </div>
    </Modal>
  );
}
export function History({ note, theme, fontSize, onClose, onRestored, onError }) {
  const [rows, setRows] = useState(null),
    [selected, setSelected] = useState(null),
    [busy, setBusy] = useState(false),
    editorRef = useRef(null);
  useEffect(() => {
    api(`/notes/${note.id}/history`)
      .then((data) => {
        setRows(data);
        setSelected(data[0]);
      })
      .catch(onError);
  }, [note.id, onError]);
  return (
    <Modal title="历史版本" onClose={onClose} wide>
      <div className="history-layout">
        <div className="history-list">
          <div className="history-current">
            当前版本 <small>v{note.version}</small>
          </div>
          {rows === null ? (
            <p className="muted">正在加载…</p>
          ) : !rows.length ? (
            <p className="muted">编辑后将自动保留历史版本</p>
          ) : (
            rows.map((row) => (
              <button
                className={selected?.id === row.id ? 'selected' : ''}
                key={row.id}
                onClick={() => setSelected(row)}
              >
                {date(row.created_at)}
                <small>版本 {row.version}</small>
              </button>
            ))
          )}
        </div>
        <div className="history-preview">
          {selected ? (
            <>
              <header>
                <strong>{selected.title}</strong>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      const updated = await api(
                        `/notes/${note.id}/history/${selected.id}/restore`,
                        { method: 'POST', body: { version: note.version } },
                      );
                      onRestored(updated);
                      onClose();
                    } catch (e) {
                      onError(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  恢复此版本
                </button>
              </header>
              <NoteEditor
                key={selected.id}
                note={{
                  ...note,
                  type: selected.type || note.type,
                  content: selected.content,
                  editor_data: selected.editor_data,
                }}
                onChange={() => {}}
                readOnly
                editorRef={editorRef}
                theme={theme}
                fontSize={fontSize}
                onError={onError}
              />
            </>
          ) : (
            <div className="empty-state">
              <HistoryIcon size={36} />
              <p>选择一个历史版本</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
export function ShareDialog({ note, onClose, onUpdated, onError }) {
  const [token, setToken] = useState(note.share_token),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(false);
  const url = token ? `${location.origin}/s/${token}` : '';
  return (
    <Modal title="链接分享" onClose={onClose}>
      <div className="dialog-body">
        <div className="share-icon">
          <Link2 size={30} />
        </div>
        <p>任何获得链接的人都可以阅读这篇笔记及正文中的图片。</p>
        {token ? (
          <>
            <label className="field">
              分享链接
              <input
                aria-label="分享链接"
                readOnly
                value={url}
                onFocus={(e) => e.target.select()}
              />
            </label>
            <div className="row">
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    onError(new Error('复制失败，请选中链接手动复制'));
                  }
                }}
              >
                <Copy size={16} />
                {copied ? '已复制' : '复制链接'}
              </button>
              <button
                className="secondary danger-text"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api(`/notes/${note.id}/share`, { method: 'DELETE' });
                    setToken(null);
                    onUpdated(null);
                  } catch (e) {
                    onError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                取消分享
              </button>
            </div>
          </>
        ) : (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = await api(`/notes/${note.id}/share`, { method: 'POST' });
                setToken(result.token);
                onUpdated(result.token);
              } catch (e) {
                onError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            创建分享链接
          </button>
        )}
      </div>
    </Modal>
  );
}
export const templates = [
  {
    id: 'blank',
    name: '空白笔记',
    description: '从一个想法开始',
    content: '<p></p>',
    type: 'common',
  },
  {
    id: 'meeting',
    name: '会议纪要',
    description: '记录讨论与下一步行动',
    content:
      '<h1>会议纪要</h1><p>日期：</p><p>参会人：</p><h2>会议议题</h2><ul><li><p>议题一</p></li></ul><h2>讨论记录</h2><p></p><h2>行动清单</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><label><input type="checkbox" disabled></label><div><p>待办事项 / 负责人 / 截止时间</p></div></li></ul>',
    type: 'common',
  },
  {
    id: 'journal',
    name: '每日日记',
    description: '留下今天的小小片段',
    content:
      '<h1>' +
      new Date().toLocaleDateString('zh-CN') +
      '</h1><h2>今日记录</h2><p></p><h2>值得感谢的事</h2><ul><li><p></p></li></ul><h2>明天的计划</h2><p></p>',
    type: 'common',
  },
  {
    id: 'reading',
    name: '读书笔记',
    description: '让阅读转化为自己的知识',
    content:
      '<h1>读书笔记</h1><p>书名：</p><p>作者：</p><h2>核心观点</h2><p></p><h2>精彩摘录</h2><blockquote><p></p></blockquote><h2>我的思考</h2><p></p>',
    type: 'common',
  },
  {
    id: 'project',
    name: '项目计划',
    description: '从目标到执行',
    content:
      '<h1>项目计划</h1><h2>项目目标</h2><p></p><h2>里程碑</h2><table><tbody><tr><th>阶段</th><th>交付内容</th><th>时间</th></tr><tr><td>第一阶段</td><td></td><td></td></tr></tbody></table><h2>风险与对策</h2><p></p>',
    type: 'common',
  },
];

export const outlineTemplate = {
  id: 'outline',
  name: '大纲笔记',
  description: '梳理结构，展开思考',
  content: '<ul><li><p>主题</p><ul><li><p>想法一</p></li><li><p>想法二</p></li></ul></li></ul>',
  type: 'outline',
};
