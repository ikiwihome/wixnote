import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const collections = [
  'users',
  'sessions',
  'apiKeys',
  'folders',
  'tags',
  'notes',
  'revisions',
  'attachments',
  'comments',
];
const empty = () => ({
  format: 'wixnote-index',
  version: 1,
  system: { allowRegistration: false },
  settings: {},
  ...Object.fromEntries(collections.map((key) => [key, []])),
});
// Note and revision bodies live beside the index; only these folders are ever written.
export const bodyKinds = ['notes', 'revisions'];

function writeAtomic(file, value) {
  const temporary = file + '.' + process.pid + '.tmp';
  writeFileSync(temporary, value);
  renameSync(temporary, file);
}
function removeFile(file) {
  try {
    unlinkSync(file);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
const mtime = (file) => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
};

// Note bodies are HTML files indexed by one JSON file; the index is kept in memory and
// reloaded when another process (such as the password reset script) rewrites it.
export function openStore(directory) {
  const indexFile = path.join(directory, 'index.json');
  try {
    for (const kind of bodyKinds) {
      const folder = path.join(directory, kind);
      mkdirSync(folder, { recursive: true });
      // Bodies were briefly stored as .md; move them to .html once.
      for (const name of readdirSync(folder))
        if (name.endsWith('.md')) {
          const target = path.join(folder, name.slice(0, -3) + '.html');
          if (!existsSync(target)) renameSync(path.join(folder, name), target);
        }
    }
  } catch (cause) {
    throw new Error(
      `无法创建数据目录 ${directory}。请检查挂载是否正确，以及运行用户是否有读写权限。容器默认使用 UID/GID 1000:1000。`,
      { cause },
    );
  }
  let state,
    stamp = null,
    pending = null;
  const bodies = new Map();
  function load() {
    stamp = mtime(indexFile);
    bodies.clear();
    if (stamp === null) {
      state = empty();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(indexFile, 'utf8'));
    } catch (cause) {
      throw new Error(`索引文件 ${indexFile} 无法读取或格式错误`, { cause });
    }
    if (parsed?.format !== 'wixnote-index') throw new Error(`${indexFile} 不是 WixNote 索引文件`);
    if (parsed.version > 1) throw new Error('索引文件版本高于当前应用');
    state = { ...empty(), ...parsed };
  }
  function sync() {
    if (!pending && mtime(indexFile) !== stamp) load();
  }
  const bodyFile = (kind, id, extension = '.html') => {
    if (!bodyKinds.includes(kind)) throw new Error('Unknown body kind');
    return path.join(directory, kind, id + extension);
  };
  function body(kind, id) {
    const key = kind + '/' + id;
    if (pending?.has(key)) return pending.get(key) || { content: '', editor_data: null };
    const file = bodyFile(kind, id),
      modified = mtime(file);
    if (modified === null) return { content: '', editor_data: null };
    const cached = bodies.get(key);
    if (cached?.modified === modified) return cached;
    const editorFile = bodyFile(kind, id, '.editor.json');
    const entry = {
      modified,
      content: readFileSync(file, 'utf8'),
      editor_data: existsSync(editorFile) ? readFileSync(editorFile, 'utf8') : null,
    };
    if (kind === 'notes') bodies.set(key, entry);
    return entry;
  }
  function requirePending() {
    if (!pending) throw new Error('Store writes must run inside a transaction');
  }
  function commit(changes) {
    const removed = [];
    for (const [key, value] of changes) {
      const [kind, id] = key.split('/');
      if (!value) {
        removed.push([kind, id]);
        continue;
      }
      writeAtomic(bodyFile(kind, id), value.content);
      if (value.editor_data == null) removeFile(bodyFile(kind, id, '.editor.json'));
      else writeAtomic(bodyFile(kind, id, '.editor.json'), value.editor_data);
      if (kind === 'notes') bodies.set(key, { ...value, modified: mtime(bodyFile(kind, id)) });
    }
    writeAtomic(indexFile, JSON.stringify(state, null, 2));
    stamp = mtime(indexFile);
    for (const [kind, id] of removed) {
      bodies.delete(kind + '/' + id);
      removeFile(bodyFile(kind, id));
      removeFile(bodyFile(kind, id, '.editor.json'));
    }
  }
  load();
  return {
    get data() {
      return state;
    },
    sync,
    body,
    setBody(kind, id, content, editorData = null) {
      requirePending();
      bodyFile(kind, id);
      pending.set(kind + '/' + id, { content, editor_data: editorData });
    },
    removeBody(kind, id) {
      requirePending();
      bodyFile(kind, id);
      pending.set(kind + '/' + id, null);
    },
    // Changes become visible to readers immediately and are rolled back if the action throws.
    transaction(action) {
      if (pending) return action();
      sync();
      const snapshot = structuredClone(state);
      pending = new Map();
      try {
        const result = action();
        commit(pending);
        return result;
      } catch (e) {
        state = snapshot;
        throw e;
      } finally {
        pending = null;
      }
    },
  };
}
