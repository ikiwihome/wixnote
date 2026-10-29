import express from 'express';
import multer from 'multer';
import sanitizeHtml from 'sanitize-html';
import { randomBytes, randomUUID, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  openSync,
  readSync,
  closeSync,
  renameSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { openDatabase, transaction } from './db.js';
import { readZip, writeZip } from './zip.js';
import { marked } from 'marked';
import { decodeHTML } from 'entities';
import { editorData, storedEditorData, rewriteResources } from './document.js';
import { chromium } from 'playwright-core';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = () => new Date().toISOString();
const uuid = () => randomUUID();
const hashToken = (value) => createHash('sha256').update(value).digest('hex');
const allowedTypes = new Set(['common', 'markdown', 'outline']);
const error = (status, message) =>
  Object.assign(new Error(message), { status, publicMessage: true });
const text = (value, max = 200) => {
  if (typeof value !== 'string' || value.length > max)
    throw error(400, `文本长度应在 ${max} 字符以内`);
  return value;
};
const scryptAsync = promisify(scrypt);
const passwordHash = async (password) => {
  const salt = randomBytes(16).toString('hex');
  return salt + ':' + Buffer.from(await scryptAsync(password, salt, 64)).toString('hex');
};
async function passwordMatches(password, encoded) {
  const [salt, key] = encoded.split(':');
  return timingSafeEqual(
    Buffer.from(key, 'hex'),
    Buffer.from(await scryptAsync(password, salt, 64)),
  );
}
const cleanContent = (value, type) => {
  text(value, 5_000_000);
  if (type === 'markdown') return value;
  return sanitizeHtml(value, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'input',
      's',
      'u',
      'del',
      'span',
      'mark',
    ],
    allowedAttributes: {
      '*': ['class', 'style', 'data-type', 'data-checked'],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'title', 'width', 'height'],
      input: ['type', 'checked', 'disabled'],
      td: ['colspan', 'rowspan', 'colwidth'],
      th: ['colspan', 'rowspan', 'colwidth'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'text-align': [/^(left|right|center|justify)$/],
        color: [/^#[0-9a-fA-F]{3,8}$/],
        'background-color': [/^#[0-9a-fA-F]{3,8}$/],
      },
    },
    transformTags: {
      a: (tag, attrs) => ({ tagName: tag, attribs: { ...attrs, rel: 'noopener noreferrer' } }),
      input: (tag, attrs) => ({
        tagName: tag,
        attribs: {
          type: 'checkbox',
          disabled: '',
          ...(Object.hasOwn(attrs, 'checked') ? { checked: '' } : {}),
        },
      }),
    },
  });
};
const extractText = (content) =>
  decodeHTML(sanitizeHtml(content, { allowedTags: [], allowedAttributes: {} }));
const inlineImage = (buffer) => {
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return 'image/png';
  if (buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return 'image/jpeg';
  if (/^GIF8[79]a/.test(buffer.subarray(0, 6).toString())) return 'image/gif';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP')
    return 'image/webp';
  return null;
};

function validateFolderTree(rows) {
  const records = new Map(rows.map((row) => [row.id, row])),
    depths = new Map();
  for (const row of rows) {
    const trail = [],
      seen = new Set();
    let cursor = row;
    while (cursor && !depths.has(cursor.id)) {
      if (seen.has(cursor.id)) throw error(400, '文件夹包含循环');
      seen.add(cursor.id);
      trail.push(cursor);
      if (trail.length > 64) throw error(400, '文件夹层级不能超过 64');
      if (!cursor.parent_id) {
        cursor = null;
        break;
      }
      cursor = records.get(cursor.parent_id);
      if (!cursor) throw error(400, '父文件夹不存在');
    }
    let depth = cursor ? depths.get(cursor.id) : 0;
    for (const item of trail.reverse()) {
      if (++depth > 64) throw error(400, '文件夹层级不能超过 64');
      depths.set(item.id, depth);
    }
  }
}

export function createApp({
  dataDir = process.env.DATA_DIR || path.join(project, 'data'),
  secureCookie = process.env.SECURE_COOKIE === 'true',
  allowRegistration = process.env.ALLOW_REGISTRATION === 'true',
} = {}) {
  const db = openDatabase(dataDir);
  const fileDir = path.join(dataDir, 'attachments');
  mkdirSync(fileDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const owner = (req) => req.user.id;
  const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });
  const folder = (id, user) => {
    const row = get('SELECT * FROM folders WHERE id=? AND user_id=?', id, user);
    if (!row) throw error(404, '文件夹不存在');
    return row;
  };
  const note = (id, user) => {
    const row = get('SELECT * FROM notes WHERE id=? AND user_id=?', id, user);
    if (!row) throw error(404, '笔记不存在');
    return row;
  };
  const noteTags = (id) =>
    all(
      'SELECT t.* FROM tags t JOIN note_tags nt ON nt.tag_id=t.id WHERE nt.note_id=? ORDER BY t.name',
      id,
    );
  const noteDetail = (row) => ({
    ...row,
    editor_data: editorData(row.editor_data),
    favorite: !!row.favorite,
    pinned: !!row.pinned,
    tags: noteTags(row.id),
    attachments: all('SELECT * FROM attachments WHERE note_id=? ORDER BY created_at', row.id),
  });
  function setTags(id, tags, user) {
    if (!Array.isArray(tags) || tags.length > 200) throw error(400, '标签格式不正确');
    for (const id of tags)
      if (typeof id !== 'string' || !get('SELECT id FROM tags WHERE id=? AND user_id=?', id, user))
        throw error(400, '标签不存在');
    run('DELETE FROM note_tags WHERE note_id=?', id);
    for (const tag of new Set(tags)) run('INSERT INTO note_tags VALUES (?,?)', id, tag);
  }
  function revision(row) {
    run(
      'INSERT INTO revisions(id,note_id,title,content,type,created_at,version,editor_data) VALUES(?,?,?,?,?,?,?,?)',
      uuid(),
      row.id,
      row.title,
      row.content,
      row.type,
      now(),
      row.version,
      row.editor_data,
    );
  }
  function insertNote(user, data) {
    const id = uuid(),
      date = now(),
      type = data.type || 'common';
    if (!allowedTypes.has(type)) throw error(400, '不支持的笔记类型');
    if (data.folder_id) folder(data.folder_id, user);
    const content = cleanContent(data.content || '', type);
    run(
      'INSERT INTO notes(id,user_id,folder_id,title,content,text,type,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)',
      id,
      user,
      data.folder_id || null,
      text(data.title || '无标题笔记', 500),
      content,
      type === 'markdown' ? content : extractText(content),
      type,
      date,
      date,
    );
    if (data.editor_data != null)
      run('UPDATE notes SET editor_data=? WHERE id=?', storedEditorData(data.editor_data), id);
    if (data.tags) setTags(id, data.tags, user);
    return note(id, user);
  }
  function session(req, res, user) {
    const token = randomBytes(32).toString('hex');
    run('DELETE FROM sessions WHERE expires_at < ?', Date.now());
    run(
      'INSERT INTO sessions VALUES(?,?,?)',
      hashToken(token),
      user.id,
      Date.now() + 30 * 86400000,
    );
    res.cookie('wix_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
      maxAge: 30 * 86400000,
      path: '/',
    });
    res.json({ user: publicUser(user) });
  }
  const attempts = new Map();
  app.use((req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self'",
    });
    if (req.path === '/editor/frame.html')
      res.set(
        'Content-Security-Policy',
        "default-src 'none'; script-src 'self' 'unsafe-eval' https://www.draw.io https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src data: blob: https:; font-src 'self' data:; connect-src blob:; frame-src https://embed.diagrams.net; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; sandbox allow-scripts",
      );
    if (req.path.startsWith('/api') || req.path.startsWith('/files'))
      res.set('Cache-Control', 'no-store');
    if (req.path.startsWith('/editor/')) res.set('Cache-Control', 'no-cache');
    if (
      req.path.startsWith('/api') &&
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.get('X-Wix-Request') !== '1'
    )
      return next(error(403, '请求来源验证失败'));
    next();
  });
  app.get('/api/health', (_req, res) => {
    get('SELECT 1');
    res.json({ ok: true, version: '0.1.0' });
  });
  app.use((req, _res, next) => {
    const authorization = req.get('Authorization');
    if (authorization) {
      const match = /^Bearer (wn_[a-f0-9]{64})$/.exec(authorization);
      const allowed =
        (req.path === '/api/notes' && ['GET', 'POST'].includes(req.method)) ||
        (/^\/api\/notes\/[^/]+$/.test(req.path) && ['GET', 'PATCH'].includes(req.method));
      if (!match || !allowed) return next(error(401, 'API Key 无效或无权访问此接口'));
      req.user = get(
        'SELECT u.* FROM users u JOIN api_keys k ON k.user_id=u.id WHERE k.token_hash=?',
        hashToken(match[1]),
      );
      if (!req.user) return next(error(401, 'API Key 无效或已撤销'));
      return next();
    }
    const token = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('wix_session='))
      ?.slice(12);
    if (token && /^[a-f0-9]{64}$/.test(token))
      req.user = get(
        'SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires_at>?',
        hashToken(token),
        Date.now(),
      );
    next();
  });
  const publicJson = express.json({ limit: '16kb' }),
    noteJson = express.json({ limit: '12mb' }),
    backupJson = express.json({ limit: '160mb' });
  app.use((req, res, next) => {
    const parser = !req.user
      ? publicJson
      : ['/api/import', '/api/export/pdf'].includes(req.path)
        ? backupJson
        : noteJson;
    parser(req, res, next);
  });
  function authAttempt(req, kind) {
    const key = kind + ':' + req.ip,
      current = Date.now();
    const state = attempts.get(key) || { count: 0, since: current };
    if (current - state.since > 900000) {
      state.count = 0;
      state.since = current;
    }
    if (state.count >= 20) throw error(429, '认证尝试过多，请 15 分钟后重试');
    if (!attempts.has(key) && attempts.size >= 10000) attempts.delete(attempts.keys().next().value);
    state.count++;
    attempts.set(key, state);
    return key;
  }
  app.get('/api/auth', (req, res) =>
    res.json({
      user: req.user ? publicUser(req.user) : null,
      needsSetup: !get('SELECT id FROM users LIMIT 1'),
      allowRegistration,
    }),
  );
  app.post('/api/auth/register', async (req, res) => {
    authAttempt(req, 'register');
    const email = text(req.body.email, 254).trim().toLowerCase(),
      name = text(req.body.name, 100).trim(),
      password = text(req.body.password, 200);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
      throw error(400, '请输入有效邮箱、姓名和至少 10 位密码');
    if (!allowRegistration && get('SELECT id FROM users LIMIT 1'))
      throw error(403, '注册已关闭，请联系部署管理员');
    const encodedPassword = await passwordHash(password);
    const user = transaction(db, () => {
      if (!allowRegistration && get('SELECT id FROM users LIMIT 1'))
        throw error(403, '注册已关闭，请联系部署管理员');
      if (get('SELECT id FROM users WHERE email=?', email)) throw error(409, '邮箱已注册');
      const id = uuid();
      run('INSERT INTO users VALUES(?,?,?,?,?)', id, email, name, encodedPassword, now());
      const ids = [];
      for (const [position, label] of ['我的笔记', '我的日记', '我的工作', '我的学习'].entries()) {
        const fid = uuid();
        run('INSERT INTO folders VALUES(?,?,?,?,?)', fid, id, null, label, position);
        ids.push(fid);
      }
      insertNote(id, {
        title: '欢迎使用 WixNote 灵眸笔记',
        folder_id: ids[0],
        content:
          '<h1>让知识，有迹可循</h1><p>欢迎来到你的私人笔记空间。记录想法、整理知识，把重要的内容留在自己手中。</p><h2>从一篇笔记开始</h2><p>点击左侧「新建笔记」，或使用 <strong>Ctrl / ⌘ + N</strong>，开始记录。</p><ul><li>用文件夹与标签整理内容</li><li>用富文本或大纲记录想法</li><li>收藏重要笔记，全文搜索快速找到内容</li><li>点击保存图标保存修改，历史版本和回收站守护你的记录</li></ul><blockquote><p>好记性，不如一篇好笔记。</p></blockquote><h2>数据属于你</h2><p>在设置中导出完整备份。所有笔记与附件都保存在你的服务器上。</p>',
      });
      return get('SELECT * FROM users WHERE id=?', id);
    });
    session(req, res, user);
  });
  app.post('/api/auth/login', async (req, res) => {
    const key = authAttempt(req, 'login');
    const email = text(req.body.email, 254).trim(),
      password = text(req.body.password, 200),
      user = get('SELECT * FROM users WHERE email=?', email);
    const valid = await passwordMatches(
      password,
      user?.password || '0'.repeat(32) + ':' + '0'.repeat(128),
    );
    if (
      !user ||
      !valid ||
      get('SELECT password FROM users WHERE id=?', user.id)?.password !== user.password
    )
      throw error(401, '邮箱或密码错误');
    attempts.delete(key);
    session(req, res, user);
  });
  app.post('/api/auth/logout', (req, res) => {
    const token = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('wix_session='))
      ?.slice(12);
    if (token) run('DELETE FROM sessions WHERE token=?', hashToken(token));
    res.clearCookie('wix_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
    });
    res.json({ ok: true });
  });
  function sendFile(res, attachment) {
    const file = path.join(fileDir, attachment.id);
    if (!existsSync(file)) throw error(404, '附件文件不存在');
    const signature = Buffer.alloc(12),
      descriptor = openSync(file, 'r');
    try {
      readSync(descriptor, signature, 0, signature.length, 0);
    } finally {
      closeSync(descriptor);
    }
    const mime = inlineImage(signature);
    res.set('Content-Type', mime || 'application/octet-stream');
    res.set(
      'Content-Disposition',
      `${mime ? 'inline' : 'attachment'}; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.name.toWellFormed()).replace(/'/g, '%27')}`,
    );
    res.set('Content-Security-Policy', "default-src 'none'; sandbox");
    res.sendFile(file);
  }
  app.get('/api/public/:token', (req, res) => {
    const row = get(
      'SELECT * FROM notes WHERE share_token=? AND deleted_at IS NULL',
      req.params.token,
    );
    if (!row) throw error(404, '分享已取消或笔记不存在');
    const content = row.content.replace(
      /\/files\/([a-f0-9-]{36})/g,
      `/api/public/${req.params.token}/files/$1`,
    );
    res.json({
      title: row.title,
      content,
      type: row.type,
      updated_at: row.updated_at,
      author: get('SELECT name FROM users WHERE id=?', row.user_id).name,
    });
  });
  app.get('/api/public/:token/files/:id', (req, res) => {
    const attachment = get(
      'SELECT a.* FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND n.share_token=? AND n.deleted_at IS NULL',
      req.params.id,
      req.params.token,
    );
    if (!attachment) throw error(404, '附件不存在');
    sendFile(res, attachment);
  });
  app.use(['/api', '/files'], (req, _res, next) => {
    if (!req.user) return next(error(401, '请先登录'));
    next();
  });
  app.post('/api/export/pdf', async (req, res) => {
    const html = text(req.body.html, 160 * 1024 * 1024);
    const executablePath = [
      process.env.CHROMIUM_PATH,
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      process.env.PROGRAMFILES &&
        path.join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      process.env['PROGRAMFILES(X86)'] &&
        path.join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    ].find((candidate) => candidate && existsSync(candidate));
    if (!executablePath) throw error(503, 'PDF 导出需要安装 Chromium 并设置 CHROMIUM_PATH');
    const browser = await chromium.launch({ executablePath, headless: true });
    try {
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: 'block',
      });
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
      res.type('application/pdf').send(pdf);
    } finally {
      await browser.close();
    }
  });
  app.get('/api/bootstrap', (req, res) => {
    res.json({
      user: publicUser(req.user),
      folders: all('SELECT * FROM folders WHERE user_id=? ORDER BY position,name', owner(req)),
      tags: all('SELECT * FROM tags WHERE user_id=? ORDER BY name', owner(req)),
      settings: JSON.parse(
        get('SELECT value FROM settings WHERE user_id=?', owner(req))?.value || '{}',
      ),
      counts: get(
        'SELECT COUNT(*) total,COALESCE(SUM(favorite),0) favorites FROM notes WHERE user_id=? AND deleted_at IS NULL',
        owner(req),
      ),
      trash: get(
        'SELECT COUNT(*) count FROM notes WHERE user_id=? AND deleted_at IS NOT NULL',
        owner(req),
      ).count,
    });
  });
  app.patch('/api/account', async (req, res) => {
    const user = owner(req),
      name = text(req.body.name || req.user.name, 100).trim();
    if (!name) throw error(400, '姓名不能为空');
    let encodedPassword = null;
    if (req.body.password) {
      authAttempt(req, 'password');
      const password = text(req.body.password, 200);
      if (password.length < 10) throw error(400, '密码至少 10 位');
      if (!(await passwordMatches(text(req.body.currentPassword, 200), req.user.password)))
        throw error(403, '当前密码错误');
      encodedPassword = await passwordHash(password);
    }
    transaction(db, () => {
      if (encodedPassword) {
        if (get('SELECT password FROM users WHERE id=?', user).password !== req.user.password)
          throw error(409, '密码已在其他窗口修改，请重新登录');
        run('UPDATE users SET password=? WHERE id=?', encodedPassword, user);
        run('DELETE FROM sessions WHERE user_id=?', user);
      }
      run('UPDATE users SET name=? WHERE id=?', name, user);
    });
    session(req, res, get('SELECT * FROM users WHERE id=?', user));
  });
  app.get('/api/api-keys', (req, res) => {
    res.json(
      all(
        'SELECT id,name,created_at FROM api_keys WHERE user_id=? ORDER BY created_at DESC',
        owner(req),
      ),
    );
  });
  app.post('/api/api-keys', (req, res) => {
    const name = text(req.body.name || 'CLI', 100).trim();
    if (!name) throw error(400, '密钥名称不能为空');
    const id = uuid(),
      token = 'wn_' + randomBytes(32).toString('hex'),
      created_at = now();
    run(
      'INSERT INTO api_keys(id,user_id,token_hash,name,created_at) VALUES(?,?,?,?,?)',
      id,
      owner(req),
      hashToken(token),
      name,
      created_at,
    );
    res.status(201).json({ id, name, created_at, token });
  });
  app.delete('/api/api-keys/:id', (req, res) => {
    const result = run('DELETE FROM api_keys WHERE id=? AND user_id=?', req.params.id, owner(req));
    if (!result.changes) throw error(404, '密钥不存在');
    res.json({ ok: true });
  });
  app.put('/api/settings', (req, res) => {
    const changes = req.body;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes))
      throw error(400, '设置格式无效');
    for (const [key, value] of Object.entries(changes)) {
      if (key === 'theme' && ['light', 'dark', 'system'].includes(value)) continue;
      if (key === 'fontSize' && Number.isInteger(value) && value >= 10 && value <= 36) continue;
      if (key === 'listView' && ['detail', 'compact'].includes(value)) continue;
      throw error(400, '设置值无效');
    }
    const existing = JSON.parse(
      get('SELECT value FROM settings WHERE user_id=?', owner(req))?.value || '{}',
    );
    const result = {
        ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
        ...changes,
      },
      value = JSON.stringify(result);
    run(
      'INSERT INTO settings VALUES(?,?) ON CONFLICT(user_id) DO UPDATE SET value=excluded.value',
      owner(req),
      value,
    );
    res.json(result);
  });
  app.post('/api/folders', (req, res) => {
    const id = uuid(),
      name = text(req.body.name, 100).trim();
    if (!name) throw error(400, '文件夹名称不能为空');
    if (req.body.parent_id) folder(req.body.parent_id, owner(req));
    validateFolderTree([
      ...all('SELECT id,parent_id FROM folders WHERE user_id=?', owner(req)),
      { id, parent_id: req.body.parent_id || null },
    ]);
    run(
      'INSERT INTO folders VALUES(?,?,?,?,?)',
      id,
      owner(req),
      req.body.parent_id || null,
      name,
      Date.now(),
    );
    res.status(201).json(folder(id, owner(req)));
  });
  app.patch('/api/folders/:id', (req, res) => {
    const row = folder(req.params.id, owner(req));
    let parent = Object.hasOwn(req.body, 'parent_id') ? req.body.parent_id : row.parent_id;
    if (parent) folder(parent, owner(req));
    if (Object.hasOwn(req.body, 'parent_id'))
      validateFolderTree(
        all('SELECT id,parent_id FROM folders WHERE user_id=?', owner(req)).map((item) =>
          item.id === row.id ? { ...item, parent_id: parent || null } : item,
        ),
      );
    const name = text(req.body.name ?? row.name, 100).trim();
    if (!name) throw error(400, '文件夹名称不能为空');
    run('UPDATE folders SET parent_id=?,name=? WHERE id=?', parent || null, name, row.id);
    res.json(folder(row.id, owner(req)));
  });
  app.delete('/api/folders/:id', (req, res) => {
    const row = folder(req.params.id, owner(req));
    transaction(db, () => {
      run(
        'UPDATE notes SET folder_id=?,version=version+1,updated_at=? WHERE folder_id=?',
        row.parent_id,
        now(),
        row.id,
      );
      run('UPDATE folders SET parent_id=? WHERE parent_id=?', row.parent_id, row.id);
      run('DELETE FROM folders WHERE id=?', row.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/tags', (req, res) => {
    const name = text(req.body.name, 100).trim();
    if (!name) throw error(400, '标签不能为空');
    let tag = get('SELECT * FROM tags WHERE user_id=? AND name=?', owner(req), name);
    if (!tag) {
      const id = uuid();
      run('INSERT INTO tags(id,user_id,name) VALUES(?,?,?)', id, owner(req), name);
      tag = get('SELECT * FROM tags WHERE id=?', id);
    }
    res.status(201).json(tag);
  });
  app.patch('/api/tags/:id', (req, res) => {
    const row = get('SELECT * FROM tags WHERE id=? AND user_id=?', req.params.id, owner(req));
    if (!row) throw error(404, '标签不存在');
    const name = text(req.body.name ?? row.name, 100).trim();
    if (!name) throw error(400, '标签不能为空');
    const color = text(req.body.color ?? row.color, 10);
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw error(400, '颜色无效');
    run('UPDATE tags SET name=?,color=? WHERE id=?', name, color, row.id);
    res.json(get('SELECT * FROM tags WHERE id=?', row.id));
  });
  app.delete('/api/tags/:id', (req, res) => {
    transaction(db, () => {
      run(
        'UPDATE notes SET version=version+1,updated_at=? WHERE user_id=? AND id IN (SELECT note_id FROM note_tags WHERE tag_id=?)',
        now(),
        owner(req),
        req.params.id,
      );
      run('DELETE FROM tags WHERE id=? AND user_id=?', req.params.id, owner(req));
    });
    res.json({ ok: true });
  });
  app.get('/api/notes', (req, res) => {
    const values = [owner(req)],
      where = [
        'n.user_id=?',
        req.query.view === 'trash' ? 'n.deleted_at IS NOT NULL' : 'n.deleted_at IS NULL',
      ];
    if (req.query.view === 'favorites') where.push('n.favorite=1');
    if (req.query.folder) {
      folder(req.query.folder, owner(req));
      where.push(
        'n.folder_id IN (WITH RECURSIVE tree(id) AS (SELECT id FROM folders WHERE id=? UNION ALL SELECT f.id FROM folders f JOIN tree t ON f.parent_id=t.id) SELECT id FROM tree)',
      );
      values.push(req.query.folder);
    }
    if (req.query.tag) {
      where.push('EXISTS(SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id AND nt.tag_id=?)');
      values.push(req.query.tag);
    }
    if (req.query.q) {
      const q = '%' + text(req.query.q, 500).replace(/[!%_]/g, '!$&') + '%';
      where.push("(n.title LIKE ? ESCAPE '!' OR n.text LIKE ? ESCAPE '!')");
      values.push(q, q);
    }
    const sorts = {
      updated: 'n.updated_at',
      created: 'n.created_at',
      title: 'n.title COLLATE NOCASE',
    };
    const sort = Object.hasOwn(sorts, req.query.sort) ? sorts[req.query.sort] : sorts.updated;
    const direction = req.query.direction === 'asc' ? 'ASC' : 'DESC';
    const rows = all(
      `SELECT n.id,n.folder_id,n.title,n.type,n.favorite,n.pinned,n.deleted_at,n.created_at,n.updated_at,n.version,substr(n.text,1,240) excerpt,(SELECT COUNT(*) FROM attachments a WHERE a.note_id=n.id) attachment_count FROM notes n WHERE ${where.join(' AND ')} ORDER BY n.pinned DESC,${sort} ${direction}`,
      ...values,
    );
    res.json(
      rows.map((row) => ({
        ...row,
        favorite: !!row.favorite,
        pinned: !!row.pinned,
        tags: noteTags(row.id),
      })),
    );
  });
  app.post('/api/notes', (req, res) =>
    res.status(201).json(noteDetail(transaction(db, () => insertNote(owner(req), req.body)))),
  );
  app.get('/api/notes/:id', (req, res) => res.json(noteDetail(note(req.params.id, owner(req)))));
  app.patch('/api/notes/:id', (req, res) => {
    const row = note(req.params.id, owner(req)),
      body = req.body;
    if (body.version !== row.version) throw error(409, '笔记已在其他窗口更新，请重新载入后编辑');
    if (row.deleted_at && !Object.hasOwn(body, 'deleted_at')) throw error(400, '请先恢复此笔记');
    const type = body.type ?? row.type;
    if (!allowedTypes.has(type)) throw error(400, '笔记类型错误');
    const title = text(body.title ?? row.title, 500),
      content = cleanContent(body.content ?? row.content, type);
    const folderId = Object.hasOwn(body, 'folder_id') ? body.folder_id : row.folder_id;
    if (folderId) folder(folderId, owner(req));
    const deleted = Object.hasOwn(body, 'deleted_at')
      ? body.deleted_at
        ? now()
        : null
      : row.deleted_at;
    const native = Object.hasOwn(body, 'editor_data')
      ? storedEditorData(body.editor_data)
      : content !== row.content || type !== row.type
        ? null
        : row.editor_data;
    transaction(db, () => {
      if (
        title !== row.title ||
        content !== row.content ||
        type !== row.type ||
        native !== row.editor_data
      )
        revision(row);
      run(
        'UPDATE notes SET title=?,content=?,text=?,type=?,folder_id=?,favorite=?,pinned=?,deleted_at=?,updated_at=?,editor_data=?,version=version+1 WHERE id=?',
        title,
        content,
        type === 'markdown' ? content : extractText(content),
        type,
        folderId || null,
        Object.hasOwn(body, 'favorite') ? +!!body.favorite : row.favorite,
        Object.hasOwn(body, 'pinned') ? +!!body.pinned : row.pinned,
        deleted,
        now(),
        native,
        row.id,
      );
      if (body.tags) setTags(row.id, body.tags, owner(req));
    });
    res.json(noteDetail(note(row.id, owner(req))));
  });
  function removeNote(row) {
    const files = all('SELECT id FROM attachments WHERE note_id=?', row.id);
    run('DELETE FROM notes WHERE id=?', row.id);
    for (const file of files)
      try {
        unlinkSync(path.join(fileDir, file.id));
      } catch (e) {
        if (e.code !== 'ENOENT') console.error('Attachment cleanup:', e.message);
      }
  }
  app.delete('/api/notes/:id', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (!row.deleted_at) throw error(400, '请先移入回收站');
    removeNote(row);
    res.json({ ok: true });
  });
  app.delete('/api/trash', (req, res) => {
    for (const row of all(
      'SELECT * FROM notes WHERE user_id=? AND deleted_at IS NOT NULL',
      owner(req),
    ))
      removeNote(row);
    res.json({ ok: true });
  });
  app.post('/api/notes/:id/duplicate', (req, res) => {
    const row = note(req.params.id, owner(req)),
      written = [];
    let copied;
    try {
      copied = transaction(db, () => {
        const result = insertNote(owner(req), {
            ...row,
            title: row.title + ' - 副本',
            tags: noteTags(row.id).map((t) => t.id),
          }),
          mapping = new Map();
        for (const item of all('SELECT * FROM attachments WHERE note_id=?', row.id)) {
          const id = uuid();
          writeFileSync(path.join(fileDir, id), readFileSync(path.join(fileDir, item.id)), {
            flag: 'wx',
          });
          written.push(id);
          mapping.set(item.id, id);
          run(
            'INSERT INTO attachments VALUES(?,?,?,?,?,?)',
            id,
            result.id,
            item.name,
            item.mime,
            item.size,
            now(),
          );
        }
        const content = result.content.replace(
          /\/files\/([a-f0-9-]{36})/g,
          (_m, id) => '/files/' + (mapping.get(id) || id),
        );
        run(
          'UPDATE notes SET content=?,text=?,editor_data=? WHERE id=?',
          content,
          result.type === 'markdown' ? content : extractText(content),
          result.editor_data ? rewriteResources(result.editor_data, mapping) : null,
          result.id,
        );
        return note(result.id, owner(req));
      });
    } catch (e) {
      for (const id of written)
        try {
          unlinkSync(path.join(fileDir, id));
        } catch {
          // Preserve the original transaction error if cleanup also fails.
        }
      throw e;
    }
    res.status(201).json(noteDetail(copied));
  });
  app.get('/api/notes/:id/history', (req, res) => {
    note(req.params.id, owner(req));
    res.json(
      all('SELECT * FROM revisions WHERE note_id=? ORDER BY version DESC', req.params.id).map(
        (row) => ({ ...row, editor_data: editorData(row.editor_data) }),
      ),
    );
  });
  app.post('/api/notes/:id/history/:revision/restore', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (req.body.version !== row.version) throw error(409, '笔记版本已变化');
    if (row.deleted_at) throw error(400, '请先恢复此笔记');
    const old = get(
      'SELECT * FROM revisions WHERE id=? AND note_id=?',
      req.params.revision,
      row.id,
    );
    if (!old) throw error(404, '历史版本不存在');
    transaction(db, () => {
      revision(row);
      run(
        'UPDATE notes SET title=?,content=?,text=?,type=?,editor_data=?,version=version+1,updated_at=? WHERE id=?',
        old.title,
        old.content,
        old.type === 'markdown' ? old.content : extractText(old.content),
        old.type,
        old.editor_data,
        now(),
        row.id,
      );
    });
    res.json(noteDetail(note(row.id, owner(req))));
  });
  // Favorite is a list marker, not content, so it skips the version and modified time.
  app.put('/api/notes/:id/favorite', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (row.deleted_at) throw error(400, '请先恢复此笔记');
    const favorite = !!req.body.favorite;
    run('UPDATE notes SET favorite=? WHERE id=?', +favorite, row.id);
    res.json({ favorite });
  });
  app.post('/api/notes/:id/share', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (row.deleted_at) throw error(400, '回收站中的笔记不能分享');
    const token = row.share_token || randomBytes(24).toString('hex');
    run('UPDATE notes SET share_token=? WHERE id=?', token, row.id);
    res.json({ token });
  });
  app.delete('/api/notes/:id/share', (req, res) => {
    const row = note(req.params.id, owner(req));
    run('UPDATE notes SET share_token=NULL WHERE id=?', row.id);
    res.json({ ok: true });
  });
  const uploadMb = Number(process.env.MAX_UPLOAD_MB || 100);
  if (!Number.isFinite(uploadMb) || uploadMb < 1 || uploadMb > 1024)
    throw new Error('MAX_UPLOAD_MB must be between 1 and 1024');
  const uploadLimit = uploadMb * 1024 * 1024;
  const temporaryUploads = path.join(dataDir, '.uploads');
  mkdirSync(temporaryUploads, { recursive: true, mode: 0o700 });
  const upload = multer({
    storage: multer.diskStorage({
      destination: temporaryUploads,
      filename: (_req, _file, done) => done(null, uuid()),
    }),
    limits: { fileSize: uploadLimit, files: 1 },
  });
  function receiveUpload(req, res, next) {
    const cleanup = () => {
      if (req.file?.path)
        try {
          unlinkSync(req.file.path);
        } catch (error) {
          if (error.code !== 'ENOENT') console.error('Temporary upload cleanup failed');
        }
    };
    res.once('finish', cleanup);
    res.once('close', cleanup);
    upload.single('file')(req, res, next);
  }
  app.post('/api/import/zip', receiveUpload, (req, res) => {
    if (!req.file) throw error(400, '请选择未加密的 ZIP 文件');
    if (req.file.size > 100 * 1024 * 1024) throw error(413, 'ZIP 压缩文件不能超过 100MB');
    const parsed = readZip(readFileSync(req.file.path), Math.min(uploadLimit, 100 * 1024 * 1024)),
      written = [];
    let imported;
    try {
      imported = transaction(db, () => {
        const row = insertNote(owner(req), {
          title: parsed.title || req.file.originalname.replace(/\.(?:zip|ziw)$/i, ''),
          folder_id: req.body.folder_id || null,
          content: '',
        });
        let content = parsed.content,
          native = parsed.editor_data ? JSON.stringify(parsed.editor_data) : null;
        for (const asset of parsed.assets) {
          const id = uuid(),
            url = '/files/' + id;
          writeFileSync(path.join(fileDir, id), asset.data, { flag: 'wx' });
          written.push(id);
          run(
            'INSERT INTO attachments VALUES(?,?,?,?,?,?)',
            id,
            row.id,
            path.posix.basename(asset.path),
            inlineImage(asset.data) || 'application/octet-stream',
            asset.data.length,
            now(),
          );
          if (native)
            native = native
              .replaceAll('./' + asset.path, url)
              .replaceAll(asset.path, url)
              .replaceAll(encodeURI(asset.path), url);
          content = content
            .replaceAll('./' + asset.path, url)
            .replaceAll(asset.path, url)
            .replaceAll(encodeURI(asset.path), url);
        }
        content = cleanContent(content, 'common');
        run(
          'UPDATE notes SET content=?,text=?,editor_data=? WHERE id=?',
          content,
          extractText(content),
          native ? storedEditorData(native) : null,
          row.id,
        );
        return note(row.id, owner(req));
      });
    } catch (e) {
      for (const id of written)
        try {
          unlinkSync(path.join(fileDir, id));
        } catch {
          // Preserve the original transaction error if cleanup also fails.
        }
      throw e;
    }
    res.status(201).json(noteDetail(imported));
  });
  app.get('/api/notes/:id/export/zip', (req, res) => {
    const row = note(req.params.id, owner(req)),
      files = all('SELECT * FROM attachments WHERE note_id=?', row.id);
    if (files.reduce((total, f) => total + f.size, 0) > uploadLimit)
      throw error(413, '导出资源超过 MAX_UPLOAD_MB，请改用服务器数据目录备份');
    const content =
      row.type === 'markdown' ? cleanContent(marked.parse(row.content), 'common') : row.content;
    const archive = writeZip(
      { ...row, content },
      files.map((f) => ({ ...f, data: readFileSync(path.join(fileDir, f.id)) })),
    );
    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="note.zip"; filename*=UTF-8''${encodeURIComponent(row.title + '.zip').replace(/'/g, '%27')}`,
    });
    res.send(archive);
  });
  app.post(
    '/api/notes/:id/attachments',
    (req, res, next) => {
      try {
        const row = note(req.params.id, owner(req));
        if (row.deleted_at) throw error(400, '请先恢复此笔记');
        next();
      } catch (e) {
        next(e);
      }
    },
    receiveUpload,
    (req, res) => {
      if (!req.file) throw error(400, '请选择附件');
      const current = note(req.params.id, owner(req));
      if (current.deleted_at) throw error(409, '笔记已移入回收站，附件未写入');
      const id = uuid();
      let name = req.file.originalname;
      try {
        name = Buffer.from(name, 'latin1').toString('utf8');
        if (name.includes('\uFFFD')) name = req.file.originalname;
      } catch {
        // Keep the original filename when legacy encoding recovery is unavailable.
      }
      name = text(name, 500).replace(/[\r\n]/g, '');
      const signature = Buffer.alloc(12),
        handle = openSync(req.file.path, 'r');
      try {
        readSync(handle, signature, 0, 12, 0);
      } finally {
        closeSync(handle);
      }
      const mime = inlineImage(signature) || 'application/octet-stream';
      renameSync(req.file.path, path.join(fileDir, id));
      try {
        run(
          'INSERT INTO attachments VALUES(?,?,?,?,?,?)',
          id,
          req.params.id,
          name,
          mime,
          req.file.size,
          now(),
        );
      } catch (e) {
        unlinkSync(path.join(fileDir, id));
        throw e;
      }
      res
        .status(201)
        .json({ ...get('SELECT * FROM attachments WHERE id=?', id), url: '/files/' + id });
    },
  );
  app.get('/files/:id', (req, res) => {
    const row = get(
      'SELECT a.* FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND n.user_id=?',
      req.params.id,
      owner(req),
    );
    if (!row) throw error(404, '附件不存在');
    sendFile(res, row);
  });
  app.delete('/api/attachments/:id', (req, res) => {
    const row = get(
      'SELECT a.* FROM attachments a JOIN notes n ON n.id=a.note_id WHERE a.id=? AND n.user_id=?',
      req.params.id,
      owner(req),
    );
    if (!row) throw error(404, '附件不存在');
    run('DELETE FROM attachments WHERE id=?', row.id);
    try {
      unlinkSync(path.join(fileDir, row.id));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    res.json({ ok: true });
  });
  app.get('/api/notes/:id/comments', (req, res) => {
    note(req.params.id, owner(req));
    res.json(all('SELECT * FROM comments WHERE note_id=? ORDER BY created_at', req.params.id));
  });
  app.post('/api/notes/:id/comments', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (row.deleted_at) throw error(400, '请先恢复此笔记');
    const body = text(req.body.body, 10000).trim();
    if (!body) throw error(400, '评论不能为空');
    const id = uuid();
    run('INSERT INTO comments VALUES(?,?,?,?)', id, row.id, body, now());
    res.status(201).json(get('SELECT * FROM comments WHERE id=?', id));
  });
  app.delete('/api/comments/:id', (req, res) => {
    run(
      'DELETE FROM comments WHERE id=? AND note_id IN (SELECT id FROM notes WHERE user_id=?)',
      req.params.id,
      owner(req),
    );
    res.json({ ok: true });
  });
  app.get('/api/backup', (req, res) => {
    const user = owner(req),
      notes = all('SELECT * FROM notes WHERE user_id=?', user),
      files = all(
        'SELECT a.* FROM attachments a JOIN notes n ON n.id=a.note_id WHERE n.user_id=?',
        user,
      );
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    if (bytes > 100 * 1024 * 1024)
      throw error(413, '附件总量超过 100MB，请使用 README 中的服务器数据目录备份方式');
    const payload = {
      format: 'wixnote',
      version: 1,
      exportedAt: now(),
      folders: all('SELECT * FROM folders WHERE user_id=?', user),
      tags: all('SELECT * FROM tags WHERE user_id=?', user),
      notes: notes.map((n) => ({ ...n, tags: noteTags(n.id).map((t) => t.id) })),
      attachments: files.map((f) => ({
        ...f,
        data: readFileSync(path.join(fileDir, f.id)).toString('base64'),
      })),
      revisions: all(
        'SELECT r.* FROM revisions r JOIN notes n ON n.id=r.note_id WHERE n.user_id=?',
        user,
      ),
      comments: all(
        'SELECT c.* FROM comments c JOIN notes n ON n.id=c.note_id WHERE n.user_id=?',
        user,
      ),
    };
    res.set(
      'Content-Disposition',
      `attachment; filename="wixnote-backup-${now().slice(0, 10)}.json"`,
    );
    const serialized = JSON.stringify(payload);
    if (Buffer.byteLength(serialized) > 150 * 1024 * 1024)
      throw error(413, '备份超过网页导入大小限制，请使用数据目录备份');
    res.type('application/json').send(serialized);
  });
  app.post('/api/import', (req, res) => {
    const data = req.body,
      user = owner(req),
      written = [];
    if (
      data.format !== 'wixnote' ||
      data.version !== 1 ||
      !Array.isArray(data.notes) ||
      !Array.isArray(data.folders) ||
      !Array.isArray(data.tags)
    )
      throw error(400, '请使用本站导出的 JSON 备份，HTML 和 Markdown 请在编辑器中导入');
    const collections = ['folders', 'tags', 'notes', 'attachments', 'revisions', 'comments'];
    for (const key of collections)
      if (data[key] !== undefined && (!Array.isArray(data[key]) || data[key].length > 50000))
        throw error(400, '备份数据格式或数量不正确');
    const maps = {};
    for (const key of collections) {
      maps[key] = new Map();
      for (const item of data[key] || []) {
        if (!item || typeof item.id !== 'string' || maps[key].has(item.id))
          throw error(400, '备份包含无效或重复标识');
        maps[key].set(item.id, uuid());
      }
    }
    const mapped = (kind, id) => {
      if (!id) return null;
      if (!maps[kind].has(id)) throw error(400, '备份包含无效引用');
      return maps[kind].get(id);
    };
    const rewrite = (value) => rewriteResources(value, maps.attachments);
    try {
      transaction(db, () => {
        for (const f of data.folders)
          run(
            'INSERT INTO folders VALUES(?,?,?,?,?)',
            mapped('folders', f.id),
            user,
            null,
            text(f.name, 100),
            0,
          );
        validateFolderTree(data.folders);
        for (const folder of data.folders) {
          run(
            'UPDATE folders SET parent_id=? WHERE id=?',
            mapped('folders', folder.parent_id),
            mapped('folders', folder.id),
          );
        }
        for (const t of data.tags) {
          const existing = get(
            'SELECT id FROM tags WHERE user_id=? AND name=?',
            user,
            text(t.name, 100),
          );
          if (existing) maps.tags.set(t.id, existing.id);
          else
            run(
              'INSERT INTO tags(id,user_id,name) VALUES(?,?,?)',
              mapped('tags', t.id),
              user,
              t.name,
            );
        }
        for (const n of data.notes) {
          if (!allowedTypes.has(n.type)) throw error(400, '备份笔记类型不正确');
          const content = cleanContent(rewrite(text(n.content, 5_000_000)), n.type),
            id = mapped('notes', n.id);
          run(
            'INSERT INTO notes(id,user_id,folder_id,title,content,text,type,favorite,pinned,deleted_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
            id,
            user,
            mapped('folders', n.folder_id),
            text(n.title, 500),
            content,
            n.type === 'markdown' ? content : extractText(content),
            n.type,
            +!!n.favorite,
            +!!n.pinned,
            n.deleted_at ? now() : null,
            validDate(n.created_at),
            validDate(n.updated_at),
          );
          run(
            'UPDATE notes SET editor_data=?,version=? WHERE id=?',
            n.editor_data
              ? storedEditorData(
                  rewrite(
                    typeof n.editor_data === 'string'
                      ? n.editor_data
                      : JSON.stringify(n.editor_data),
                  ),
                )
              : null,
            validVersion(n.version),
            id,
          );
          setTags(
            id,
            (n.tags || []).map((id) => mapped('tags', id)),
            user,
          );
        }
        let total = 0;
        for (const f of data.attachments || []) {
          if (typeof f.data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(f.data))
            throw error(400, '附件编码无效');
          const bytes = Buffer.from(f.data, 'base64');
          total += bytes.length;
          if (total > 100 * 1024 * 1024) throw error(413, '附件备份过大');
          const id = mapped('attachments', f.id);
          writeFileSync(path.join(fileDir, id), bytes, { flag: 'wx' });
          written.push(id);
          run(
            'INSERT INTO attachments VALUES(?,?,?,?,?,?)',
            id,
            mapped('notes', f.note_id),
            text(f.name, 500),
            inlineImage(bytes) || 'application/octet-stream',
            bytes.length,
            validDate(f.created_at),
          );
        }
        for (const r of data.revisions || []) {
          if (!allowedTypes.has(r.type)) throw error(400, '历史版本类型错误');
          run(
            'INSERT INTO revisions(id,note_id,title,content,type,created_at,version,editor_data) VALUES(?,?,?,?,?,?,?,?)',
            mapped('revisions', r.id),
            mapped('notes', r.note_id),
            text(r.title, 500),
            cleanContent(rewrite(text(r.content, 5_000_000)), r.type),
            r.type,
            validDate(r.created_at),
            validVersion(r.version),
            r.editor_data
              ? storedEditorData(
                  rewrite(
                    typeof r.editor_data === 'string'
                      ? r.editor_data
                      : JSON.stringify(r.editor_data),
                  ),
                )
              : null,
          );
        }
        for (const c of data.comments || [])
          run(
            'INSERT INTO comments VALUES(?,?,?,?)',
            mapped('comments', c.id),
            mapped('notes', c.note_id),
            text(c.body, 10000),
            validDate(c.created_at),
          );
      });
    } catch (e) {
      for (const id of written)
        try {
          unlinkSync(path.join(fileDir, id));
        } catch {
          // Preserve the original transaction error if cleanup also fails.
        }
      throw e;
    }
    res.status(201).json({ imported: data.notes.length });
  });
  app.use('/api', (_req, _res, next) => next(error(404, '接口不存在')));
  const dist = path.join(project, 'dist');
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(['/', '/s/:token'], (_req, res) => {
    if (!existsSync(path.join(dist, 'index.html')))
      return res
        .status(503)
        .type('text')
        .send('Run npm run build first, or use npm run dev and open http://localhost:5173');
    res.set('Cache-Control', 'no-cache').sendFile(path.join(dist, 'index.html'));
  });
  app.use((err, _req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE')
      return res.status(413).json({ error: `附件不能超过 ${uploadLimit / 1024 / 1024}MB` });
    if (res.headersSent) return _next(err);
    if (err.type === 'entity.too.large')
      return res.status(413).json({ error: '请求内容超过大小限制' });
    if (err.code === 'ERR_SQLITE_ERROR' && err.message.includes('UNIQUE'))
      return res.status(409).json({ error: '名称或标识已存在' });
    const status = err.status || (err instanceof multer.MulterError ? 400 : 500);
    if (status >= 500 || !err.status) console.error(err);
    res.status(status).json({
      error: err.publicMessage
        ? err.message
        : status >= 500
          ? '服务器处理失败'
          : status === 404
            ? '内容不存在'
            : '请求数据无效',
    });
  });
  app.locals.db = db;
  return app;
}
function validVersion(value) {
  if (value === undefined) return 1;
  if (!Number.isSafeInteger(value) || value < 1 || value > 2147483646)
    throw error(400, '无效的版本号');
  return value;
}
function validDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return now();
  return new Date(value).toISOString();
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const app = createApp(),
    port = Number(process.env.PORT) || 3000;
  const server = app.listen(port, process.env.HOST || '0.0.0.0', () =>
    console.log(`wixnote ready on http://localhost:${port}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () =>
      server.close(() => {
        app.locals.db.close();
        process.exit(0);
      }),
    );
}
