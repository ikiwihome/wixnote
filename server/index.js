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
import { gunzipSync } from 'node:zlib';
import { openStore } from './store.js';
import { migrateSqlite } from './migrate.js';
import { readZip, writeZip, readBackupZip, writeBackupZip } from './zip.js';
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
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a, b) => compare(a.name, b.name);
const byCreated = (a, b) => compare(a.created_at, b.created_at);
const validColor = (value) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

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
} = {}) {
  const store = openStore(dataDir);
  if (migrateSqlite(dataDir, store))
    console.log('已将 wixnote.sqlite 迁移为 HTML 笔记文件与 index.json 索引');
  const fileDir = path.join(dataDir, 'attachments');
  mkdirSync(fileDir, { recursive: true });
  const app = express();
  app.disable('x-powered-by');
  // All writes go through save() so the index and note files change together or not at all.
  const db = () => store.data;
  const save = (action) => store.transaction(action);
  const owner = (req) => req.user.id;
  const userById = (id) => db().users.find((u) => u.id === id);
  const adminId = () => db().users[0]?.id;
  const registrationAllowed = () => db().system.allowRegistration === true;
  const publicUser = (user) => ({ id: user.id, name: user.name, email: user.email });
  const folder = (id, user) => {
    const row = db().folders.find((f) => f.id === id && f.user_id === user);
    if (!row) throw error(404, '文件夹不存在');
    return row;
  };
  const note = (id, user) => {
    const row = db().notes.find((n) => n.id === id && n.user_id === user);
    if (!row) throw error(404, '笔记不存在');
    return row;
  };
  const ownedAttachment = (id, user) =>
    db().attachments.find(
      (a) => a.id === id && db().notes.some((n) => n.id === a.note_id && n.user_id === user),
    );
  const texts = new WeakMap();
  const plainText = (row) => {
    const body = store.body('notes', row.id);
    if (!texts.has(body))
      texts.set(body, row.type === 'markdown' ? body.content : extractText(body.content));
    return texts.get(body);
  };
  const noteTags = (row) =>
    db()
      .tags.filter((t) => row.tags.includes(t.id))
      .sort(byName);
  const noteDetail = (row) => {
    const body = store.body('notes', row.id);
    return {
      ...row,
      content: body.content,
      text: plainText(row),
      editor_data: editorData(body.editor_data),
      tags: noteTags(row),
      attachments: db()
        .attachments.filter((a) => a.note_id === row.id)
        .sort(byCreated),
    };
  };
  function setTags(row, tags, user) {
    if (!Array.isArray(tags) || tags.length > 200) throw error(400, '标签格式不正确');
    for (const id of tags)
      if (typeof id !== 'string' || !db().tags.some((t) => t.id === id && t.user_id === user))
        throw error(400, '标签不存在');
    row.tags = [...new Set(tags)];
  }
  // Must run before the note's body is replaced, so it captures the previous content.
  function revision(row) {
    const id = uuid(),
      body = store.body('notes', row.id);
    db().revisions.push({
      id,
      note_id: row.id,
      title: row.title,
      type: row.type,
      created_at: now(),
      version: row.version,
    });
    store.setBody('revisions', id, body.content, body.editor_data);
  }
  function insertNote(user, data) {
    const id = uuid(),
      date = now(),
      type = data.type || 'common';
    if (!allowedTypes.has(type)) throw error(400, '不支持的笔记类型');
    if (data.folder_id) folder(data.folder_id, user);
    const content = cleanContent(data.content || '', type);
    const row = {
      id,
      user_id: user,
      folder_id: data.folder_id || null,
      title: text(data.title || '无标题笔记', 500),
      type,
      favorite: false,
      pinned: false,
      deleted_at: null,
      created_at: date,
      updated_at: date,
      version: 1,
      share_token: null,
      tags: [],
    };
    db().notes.push(row);
    store.setBody(
      'notes',
      id,
      content,
      data.editor_data != null ? storedEditorData(data.editor_data) : null,
    );
    if (data.tags) setTags(row, data.tags, user);
    return row;
  }
  function session(req, res, user) {
    const token = randomBytes(32).toString('hex');
    save(() => {
      const data = db();
      data.sessions = data.sessions.filter((s) => s.expires_at >= Date.now());
      data.sessions.push({
        token: hashToken(token),
        user_id: user.id,
        expires_at: Date.now() + 30 * 86400000,
      });
    });
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
    store.sync();
    res.json({ ok: true, version: '0.1.0' });
  });
  app.use((req, _res, next) => {
    store.sync();
    const authorization = req.get('Authorization');
    if (authorization) {
      const match = /^Bearer (wn_[a-f0-9]{64})$/.exec(authorization);
      const allowed =
        (req.path === '/api/notes' && ['GET', 'POST'].includes(req.method)) ||
        (/^\/api\/notes\/[^/]+$/.test(req.path) && ['GET', 'PATCH'].includes(req.method));
      if (!match || !allowed) return next(error(401, 'API Key 无效或无权访问此接口'));
      const hash = hashToken(match[1]);
      req.user = userById(db().apiKeys.find((k) => k.token_hash === hash)?.user_id);
      if (!req.user) return next(error(401, 'API Key 无效或已撤销'));
      return next();
    }
    const token = (req.headers.cookie || '')
      .split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('wix_session='))
      ?.slice(12);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const hash = hashToken(token);
      req.user = userById(
        db().sessions.find((s) => s.token === hash && s.expires_at > Date.now())?.user_id,
      );
    }
    next();
  });
  const backupZip = express.raw({ type: 'application/zip', limit: '160mb' });
  app.use('/api/import', (req, res, next) => (req.user ? backupZip(req, res, next) : next()));
  // Clients gzip JSON bodies so WAFs in front of the app don't flag note HTML as an attack.
  const jsonParser = (limit) => {
    const json = express.json({ limit }),
      raw = express.raw({ type: 'application/vnd.wix.json+gzip', limit });
    // Bodyless requests (logout, DELETE, ...) still get `{}` so routes can read req.body safely.
    const done = (req, next) => (err) => {
      req.body ??= {};
      next(err);
    };
    return (req, res, next) => {
      if (!req.is('application/vnd.wix.json+gzip')) return json(req, res, done(req, next));
      raw(req, res, (err) => {
        if (err || !Buffer.isBuffer(req.body)) return done(req, next)(err);
        if (!req.body.length) {
          req.body = {};
          return next();
        }
        try {
          const text = gunzipSync(req.body, { maxOutputLength: limit }).toString('utf8');
          req.body = JSON.parse(text);
        } catch (e) {
          return next(
            e.code === 'ERR_BUFFER_TOO_LARGE'
              ? Object.assign(e, { type: 'entity.too.large' })
              : error(400, '请求内容格式错误'),
          );
        }
        next();
      });
    };
  };
  const publicJson = jsonParser(16 * 1024),
    noteJson = jsonParser(12 * 1024 * 1024),
    pdfJson = jsonParser(160 * 1024 * 1024);
  app.use((req, res, next) => {
    const parser = !req.user ? publicJson : req.path === '/api/export/pdf' ? pdfJson : noteJson;
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
      needsSetup: !db().users.length,
      allowRegistration: registrationAllowed(),
    }),
  );
  app.post('/api/auth/register', async (req, res) => {
    authAttempt(req, 'register');
    const email = text(req.body.email, 254).trim().toLowerCase(),
      name = text(req.body.name, 100).trim(),
      password = text(req.body.password, 200);
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10)
      throw error(400, '请输入有效邮箱、姓名和至少 10 位密码');
    if (!registrationAllowed() && db().users.length) throw error(403, '注册已关闭，请联系管理员');
    const encodedPassword = await passwordHash(password);
    const user = save(() => {
      const data = db();
      if (!registrationAllowed() && data.users.length) throw error(403, '注册已关闭，请联系管理员');
      if (data.users.some((u) => u.email.toLowerCase() === email)) throw error(409, '邮箱已注册');
      const id = uuid(),
        user = { id, email, name, password: encodedPassword, created_at: now() };
      data.users.push(user);
      const ids = [];
      for (const [position, label] of ['我的笔记', '我的日记', '我的工作', '我的学习'].entries()) {
        const fid = uuid();
        data.folders.push({ id: fid, user_id: id, parent_id: null, name: label, position });
        ids.push(fid);
      }
      insertNote(id, {
        title: '欢迎使用 WixNote 灵眸笔记',
        folder_id: ids[0],
        content:
          '<h1>让知识，有迹可循</h1><p>欢迎来到你的私人笔记空间。记录想法、整理知识，把重要的内容留在自己手中。</p><h2>从一篇笔记开始</h2><p>点击左侧「新建笔记」，或使用 <strong>Ctrl / ⌘ + N</strong>，开始记录。</p><ul><li>用文件夹与标签整理内容</li><li>用富文本或大纲记录想法</li><li>收藏重要笔记，全文搜索快速找到内容</li><li>点击保存图标保存修改，历史版本和回收站守护你的记录</li></ul><blockquote><p>好记性，不如一篇好笔记。</p></blockquote><h2>数据属于你</h2><p>在设置中导出完整备份。所有笔记与附件都保存在你的服务器上。</p>',
      });
      return user;
    });
    session(req, res, user);
  });
  app.post('/api/auth/login', async (req, res) => {
    const key = authAttempt(req, 'login');
    const email = text(req.body.email, 254).trim().toLowerCase(),
      password = text(req.body.password, 200),
      user = db().users.find((u) => u.email.toLowerCase() === email);
    const valid = await passwordMatches(
      password,
      user?.password || '0'.repeat(32) + ':' + '0'.repeat(128),
    );
    store.sync();
    if (!user || !valid || userById(user.id)?.password !== user.password)
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
    if (token)
      save(() => {
        db().sessions = db().sessions.filter((s) => s.token !== hashToken(token));
      });
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
    const row = db().notes.find((n) => n.share_token === req.params.token && !n.deleted_at);
    if (!row) throw error(404, '分享已取消或笔记不存在');
    const content = store
      .body('notes', row.id)
      .content.replace(/\/files\/([a-f0-9-]{36})/g, `/api/public/${req.params.token}/files/$1`);
    res.json({
      title: row.title,
      content,
      type: row.type,
      updated_at: row.updated_at,
      author: userById(row.user_id).name,
    });
  });
  app.get('/api/public/:token/files/:id', (req, res) => {
    const shared = db().notes.find((n) => n.share_token === req.params.token && !n.deleted_at);
    const attachment =
      shared && db().attachments.find((a) => a.id === req.params.id && a.note_id === shared.id);
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
    const user = owner(req),
      notes = db().notes.filter((n) => n.user_id === user),
      live = notes.filter((n) => !n.deleted_at);
    res.json({
      user: publicUser(req.user),
      isAdmin: user === adminId(),
      allowRegistration: registrationAllowed(),
      folders: db()
        .folders.filter((f) => f.user_id === user)
        .sort((a, b) => a.position - b.position || byName(a, b)),
      tags: db()
        .tags.filter((t) => t.user_id === user)
        .sort(byName),
      settings: db().settings[user] || {},
      counts: { total: live.length, favorites: live.filter((n) => n.favorite).length },
      trash: notes.length - live.length,
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
    const updated = save(() => {
      const row = userById(user);
      if (encodedPassword) {
        if (row.password !== req.user.password)
          throw error(409, '密码已在其他窗口修改，请重新登录');
        row.password = encodedPassword;
        db().sessions = db().sessions.filter((s) => s.user_id !== user);
      }
      row.name = name;
      return row;
    });
    session(req, res, updated);
  });
  app.get('/api/api-keys', (req, res) => {
    res.json(
      db()
        .apiKeys.filter((k) => k.user_id === owner(req))
        .sort((a, b) => byCreated(b, a))
        .map(({ id, name, created_at }) => ({ id, name, created_at })),
    );
  });
  app.post('/api/api-keys', (req, res) => {
    const name = text(req.body.name || 'default', 100).trim();
    if (!name) throw error(400, '密钥名称不能为空');
    const id = uuid(),
      token = 'wn_' + randomBytes(32).toString('hex'),
      created_at = now();
    save(() =>
      db().apiKeys.push({
        id,
        user_id: owner(req),
        token_hash: hashToken(token),
        name,
        created_at,
      }),
    );
    res.status(201).json({ id, name, created_at, token });
  });
  app.delete('/api/api-keys/:id', (req, res) => {
    const key = db().apiKeys.find((k) => k.id === req.params.id && k.user_id === owner(req));
    if (!key) throw error(404, '密钥不存在');
    save(() => {
      db().apiKeys = db().apiKeys.filter((k) => k.id !== key.id);
    });
    res.json({ ok: true });
  });
  // Deletes the signed-in account with all of its notes, attachments, keys and sessions.
  app.delete('/api/account', async (req, res) => {
    const user = owner(req);
    authAttempt(req, 'password');
    if (!(await passwordMatches(text(req.body.password, 200), req.user.password)))
      throw error(403, '密码错误');
    if (user === adminId() && db().users.length > 1)
      throw error(400, '管理员账户需在其他用户全部删除后才能删除');
    removeNotes(
      new Set(
        db()
          .notes.filter((n) => n.user_id === user)
          .map((n) => n.id),
      ),
    );
    save(() => {
      const data = db();
      for (const key of ['folders', 'tags', 'apiKeys', 'sessions'])
        data[key] = data[key].filter((row) => row.user_id !== user);
      delete data.settings[user];
      data.users = data.users.filter((u) => u.id !== user);
    });
    res.clearCookie('wix_session', {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: secureCookie,
    });
    res.json({ ok: true });
  });
  // Registration is a deployment-wide switch that only the first (administrator) account may flip.
  app.put('/api/registration', (req, res) => {
    if (owner(req) !== adminId()) throw error(403, '只有管理员可以修改注册设置');
    if (typeof req.body.allowRegistration !== 'boolean') throw error(400, '设置值无效');
    save(() => {
      db().system.allowRegistration = req.body.allowRegistration;
    });
    res.json({ allowRegistration: registrationAllowed() });
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
    const existing = db().settings[owner(req)];
    const result = {
      ...(existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {}),
      ...changes,
    };
    save(() => {
      db().settings[owner(req)] = result;
    });
    res.json(result);
  });
  const userFolders = (user) => db().folders.filter((f) => f.user_id === user);
  app.post('/api/folders', (req, res) => {
    const id = uuid(),
      name = text(req.body.name, 100).trim();
    if (!name) throw error(400, '文件夹名称不能为空');
    if (req.body.parent_id) folder(req.body.parent_id, owner(req));
    validateFolderTree([...userFolders(owner(req)), { id, parent_id: req.body.parent_id || null }]);
    save(() =>
      db().folders.push({
        id,
        user_id: owner(req),
        parent_id: req.body.parent_id || null,
        name,
        position: Date.now(),
      }),
    );
    res.status(201).json(folder(id, owner(req)));
  });
  app.patch('/api/folders/:id', (req, res) => {
    const row = folder(req.params.id, owner(req));
    let parent = Object.hasOwn(req.body, 'parent_id') ? req.body.parent_id : row.parent_id;
    if (parent) folder(parent, owner(req));
    if (Object.hasOwn(req.body, 'parent_id'))
      validateFolderTree(
        userFolders(owner(req)).map((item) =>
          item.id === row.id ? { ...item, parent_id: parent || null } : item,
        ),
      );
    const name = text(req.body.name ?? row.name, 100).trim();
    if (!name) throw error(400, '文件夹名称不能为空');
    save(() => Object.assign(folder(row.id, owner(req)), { parent_id: parent || null, name }));
    res.json(folder(row.id, owner(req)));
  });
  // Reorders siblings: moves the folder under parent_id, before the sibling `before` (or last).
  app.post('/api/folders/:id/move', (req, res) => {
    const row = folder(req.params.id, owner(req)),
      parent = req.body.parent_id || null,
      before = req.body.before || null;
    if (parent) folder(parent, owner(req));
    if (before && (before === row.id || folder(before, owner(req)).parent_id !== parent))
      throw error(400, '目标位置无效');
    validateFolderTree(
      userFolders(owner(req)).map((item) =>
        item.id === row.id ? { ...item, parent_id: parent } : item,
      ),
    );
    save(() => {
      const siblings = userFolders(owner(req))
        .filter((f) => f.parent_id === parent && f.id !== row.id)
        .sort((a, b) => a.position - b.position || byName(a, b));
      const target = folder(row.id, owner(req));
      target.parent_id = parent;
      const index = before ? siblings.findIndex((f) => f.id === before) : siblings.length;
      siblings.splice(index, 0, target);
      siblings.forEach((f, position) => (f.position = position));
    });
    res.json(folder(row.id, owner(req)));
  });
  app.delete('/api/folders/:id', (req, res) => {
    const row = folder(req.params.id, owner(req));
    save(() => {
      const data = db(),
        date = now();
      for (const n of data.notes)
        if (n.folder_id === row.id)
          Object.assign(n, { folder_id: row.parent_id, version: n.version + 1, updated_at: date });
      for (const f of data.folders) if (f.parent_id === row.id) f.parent_id = row.parent_id;
      data.folders = data.folders.filter((f) => f.id !== row.id);
    });
    res.json({ ok: true });
  });
  app.post('/api/tags', (req, res) => {
    const name = text(req.body.name, 100).trim();
    if (!name) throw error(400, '标签不能为空');
    let tag = db().tags.find((t) => t.user_id === owner(req) && t.name === name);
    if (!tag) {
      tag = { id: uuid(), user_id: owner(req), name, color: '#7084a4' };
      save(() => db().tags.push(tag));
    }
    res.status(201).json(tag);
  });
  app.patch('/api/tags/:id', (req, res) => {
    const row = db().tags.find((t) => t.id === req.params.id && t.user_id === owner(req));
    if (!row) throw error(404, '标签不存在');
    const name = text(req.body.name ?? row.name, 100).trim();
    if (!name) throw error(400, '标签不能为空');
    const color = text(req.body.color ?? row.color, 10);
    if (!validColor(color)) throw error(400, '颜色无效');
    if (db().tags.some((t) => t.user_id === owner(req) && t.name === name && t.id !== row.id))
      throw error(409, '名称或标识已存在');
    const updated = save(() => {
      const tag = db().tags.find((t) => t.id === row.id);
      return Object.assign(tag, { name, color });
    });
    res.json(updated);
  });
  app.delete('/api/tags/:id', (req, res) => {
    save(() => {
      const data = db(),
        date = now();
      if (!data.tags.some((t) => t.id === req.params.id && t.user_id === owner(req))) return;
      for (const n of data.notes)
        if (n.user_id === owner(req) && n.tags.includes(req.params.id))
          Object.assign(n, {
            tags: n.tags.filter((id) => id !== req.params.id),
            version: n.version + 1,
            updated_at: date,
          });
      data.tags = data.tags.filter((t) => t.id !== req.params.id);
    });
    res.json({ ok: true });
  });
  app.get('/api/notes', (req, res) => {
    const user = owner(req),
      trash = req.query.view === 'trash';
    let rows = db().notes.filter((n) => n.user_id === user && !!n.deleted_at === trash);
    if (req.query.view === 'favorites') rows = rows.filter((n) => n.favorite);
    if (req.query.folder) {
      folder(req.query.folder, user);
      const tree = new Set([req.query.folder]),
        folders = userFolders(user);
      for (let size = 0; size !== tree.size;) {
        size = tree.size;
        for (const f of folders) if (tree.has(f.parent_id)) tree.add(f.id);
      }
      rows = rows.filter((n) => tree.has(n.folder_id));
    }
    if (req.query.tag) rows = rows.filter((n) => n.tags.includes(req.query.tag));
    if (req.query.q) {
      const q = text(req.query.q, 500).toLowerCase();
      rows = rows.filter(
        (n) => n.title.toLowerCase().includes(q) || plainText(n).toLowerCase().includes(q),
      );
    }
    const sorts = {
      updated: (n) => n.updated_at,
      created: (n) => n.created_at,
      title: (n) => n.title.toLowerCase(),
    };
    const sort = Object.hasOwn(sorts, req.query.sort) ? sorts[req.query.sort] : sorts.updated;
    const direction = req.query.direction === 'asc' ? 1 : -1;
    rows.sort((a, b) => b.pinned - a.pinned || direction * compare(sort(a), sort(b)));
    const attachments = new Map();
    for (const a of db().attachments)
      attachments.set(a.note_id, (attachments.get(a.note_id) || 0) + 1);
    res.json(
      rows.map((n) => ({
        id: n.id,
        folder_id: n.folder_id,
        title: n.title,
        type: n.type,
        favorite: n.favorite,
        pinned: n.pinned,
        deleted_at: n.deleted_at,
        created_at: n.created_at,
        updated_at: n.updated_at,
        version: n.version,
        excerpt: plainText(n).slice(0, 240),
        attachment_count: attachments.get(n.id) || 0,
        tags: noteTags(n),
      })),
    );
  });
  app.post('/api/notes', (req, res) =>
    res.status(201).json(noteDetail(save(() => insertNote(owner(req), req.body)))),
  );
  app.get('/api/notes/:id', (req, res) => res.json(noteDetail(note(req.params.id, owner(req)))));
  app.patch('/api/notes/:id', (req, res) => {
    const row = note(req.params.id, owner(req)),
      current = store.body('notes', row.id),
      body = req.body;
    if (body.version !== row.version) throw error(409, '笔记已在其他窗口更新，请重新载入后编辑');
    if (row.deleted_at && !Object.hasOwn(body, 'deleted_at')) throw error(400, '请先恢复此笔记');
    const type = body.type ?? row.type;
    if (!allowedTypes.has(type)) throw error(400, '笔记类型错误');
    const title = text(body.title ?? row.title, 500),
      content = cleanContent(body.content ?? current.content, type);
    const folderId = Object.hasOwn(body, 'folder_id') ? body.folder_id : row.folder_id;
    if (folderId) folder(folderId, owner(req));
    const deleted = Object.hasOwn(body, 'deleted_at')
      ? body.deleted_at
        ? now()
        : null
      : row.deleted_at;
    const native = Object.hasOwn(body, 'editor_data')
      ? storedEditorData(body.editor_data)
      : content !== current.content || type !== row.type
        ? null
        : current.editor_data;
    save(() => {
      const target = note(row.id, owner(req)),
        bodyChanged =
          content !== current.content || type !== target.type || native !== current.editor_data;
      if (title !== target.title || bodyChanged) revision(target);
      Object.assign(target, {
        title,
        type,
        folder_id: folderId || null,
        favorite: Object.hasOwn(body, 'favorite') ? !!body.favorite : target.favorite,
        pinned: Object.hasOwn(body, 'pinned') ? !!body.pinned : target.pinned,
        deleted_at: deleted,
        updated_at: now(),
        version: target.version + 1,
      });
      if (bodyChanged) store.setBody('notes', target.id, content, native);
      if (body.tags) setTags(target, body.tags, owner(req));
    });
    res.json(noteDetail(note(row.id, owner(req))));
  });
  function removeNotes(ids) {
    const files = db().attachments.filter((a) => ids.has(a.note_id));
    save(() => {
      const data = db();
      for (const r of data.revisions) if (ids.has(r.note_id)) store.removeBody('revisions', r.id);
      for (const id of ids) store.removeBody('notes', id);
      data.revisions = data.revisions.filter((r) => !ids.has(r.note_id));
      data.attachments = data.attachments.filter((a) => !ids.has(a.note_id));
      data.comments = data.comments.filter((c) => !ids.has(c.note_id));
      data.notes = data.notes.filter((n) => !ids.has(n.id));
    });
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
    removeNotes(new Set([row.id]));
    res.json({ ok: true });
  });
  app.delete('/api/trash', (req, res) => {
    removeNotes(
      new Set(
        db()
          .notes.filter((n) => n.user_id === owner(req) && n.deleted_at)
          .map((n) => n.id),
      ),
    );
    res.json({ ok: true });
  });
  app.post('/api/notes/:id/duplicate', (req, res) => {
    const row = note(req.params.id, owner(req)),
      source = store.body('notes', row.id),
      written = [];
    let copied;
    try {
      copied = save(() => {
        const result = insertNote(owner(req), {
            folder_id: row.folder_id,
            type: row.type,
            title: row.title + ' - 副本',
            content: source.content,
            editor_data: source.editor_data,
            tags: row.tags,
          }),
          mapping = new Map();
        for (const item of db().attachments.filter((a) => a.note_id === row.id)) {
          const id = uuid();
          writeFileSync(path.join(fileDir, id), readFileSync(path.join(fileDir, item.id)), {
            flag: 'wx',
          });
          written.push(id);
          mapping.set(item.id, id);
          db().attachments.push({
            id,
            note_id: result.id,
            name: item.name,
            mime: item.mime,
            size: item.size,
            created_at: now(),
          });
        }
        const copy = store.body('notes', result.id),
          content = copy.content.replace(
            /\/files\/([a-f0-9-]{36})/g,
            (_m, id) => '/files/' + (mapping.get(id) || id),
          );
        store.setBody(
          'notes',
          result.id,
          content,
          copy.editor_data ? rewriteResources(copy.editor_data, mapping) : null,
        );
        return result;
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
      db()
        .revisions.filter((r) => r.note_id === req.params.id)
        .sort((a, b) => b.version - a.version)
        .map((row) => {
          const body = store.body('revisions', row.id);
          return { ...row, content: body.content, editor_data: editorData(body.editor_data) };
        }),
    );
  });
  app.post('/api/notes/:id/history/:revision/restore', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (req.body.version !== row.version) throw error(409, '笔记版本已变化');
    if (row.deleted_at) throw error(400, '请先恢复此笔记');
    const old = db().revisions.find((r) => r.id === req.params.revision && r.note_id === row.id);
    if (!old) throw error(404, '历史版本不存在');
    const previous = store.body('revisions', old.id);
    save(() => {
      const target = note(row.id, owner(req));
      revision(target);
      Object.assign(target, {
        title: old.title,
        type: old.type,
        version: target.version + 1,
        updated_at: now(),
      });
      store.setBody('notes', target.id, previous.content, previous.editor_data);
    });
    res.json(noteDetail(note(row.id, owner(req))));
  });
  // Favorite is a list marker, not content, so it skips the version and modified time.
  app.put('/api/notes/:id/favorite', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (row.deleted_at) throw error(400, '请先恢复此笔记');
    const favorite = !!req.body.favorite;
    save(() => {
      note(row.id, owner(req)).favorite = favorite;
    });
    res.json({ favorite });
  });
  app.post('/api/notes/:id/share', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (row.deleted_at) throw error(400, '回收站中的笔记不能分享');
    const token = row.share_token || randomBytes(24).toString('hex');
    save(() => {
      note(row.id, owner(req)).share_token = token;
    });
    res.json({ token });
  });
  app.delete('/api/notes/:id/share', (req, res) => {
    const row = note(req.params.id, owner(req));
    save(() => {
      note(row.id, owner(req)).share_token = null;
    });
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
      imported = save(() => {
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
          db().attachments.push({
            id,
            note_id: row.id,
            name: path.posix.basename(asset.path),
            mime: inlineImage(asset.data) || 'application/octet-stream',
            size: asset.data.length,
            created_at: now(),
          });
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
        store.setBody(
          'notes',
          row.id,
          cleanContent(content, 'common'),
          native ? storedEditorData(native) : null,
        );
        return row;
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
      body = store.body('notes', row.id),
      files = db().attachments.filter((a) => a.note_id === row.id);
    if (files.reduce((total, f) => total + f.size, 0) > uploadLimit)
      throw error(413, '导出资源超过 MAX_UPLOAD_MB，请改用服务器数据目录备份');
    const content =
      row.type === 'markdown' ? cleanContent(marked.parse(body.content), 'common') : body.content;
    const archive = writeZip(
      { ...row, content, editor_data: body.editor_data },
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
      const attachment = {
        id,
        note_id: current.id,
        name,
        mime,
        size: req.file.size,
        created_at: now(),
      };
      try {
        save(() => db().attachments.push(attachment));
      } catch (e) {
        unlinkSync(path.join(fileDir, id));
        throw e;
      }
      res.status(201).json({ ...attachment, url: '/files/' + id });
    },
  );
  app.get('/files/:id', (req, res) => {
    const row = ownedAttachment(req.params.id, owner(req));
    if (!row) throw error(404, '附件不存在');
    sendFile(res, row);
  });
  app.delete('/api/attachments/:id', (req, res) => {
    const row = ownedAttachment(req.params.id, owner(req));
    if (!row) throw error(404, '附件不存在');
    save(() => {
      db().attachments = db().attachments.filter((a) => a.id !== row.id);
    });
    try {
      unlinkSync(path.join(fileDir, row.id));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    res.json({ ok: true });
  });
  app.get('/api/notes/:id/comments', (req, res) => {
    note(req.params.id, owner(req));
    res.json(
      db()
        .comments.filter((c) => c.note_id === req.params.id)
        .sort(byCreated),
    );
  });
  app.post('/api/notes/:id/comments', (req, res) => {
    const row = note(req.params.id, owner(req));
    if (row.deleted_at) throw error(400, '请先恢复此笔记');
    const body = text(req.body.body, 10000).trim();
    if (!body) throw error(400, '评论不能为空');
    const comment = { id: uuid(), note_id: row.id, body, created_at: now() };
    save(() => db().comments.push(comment));
    res.status(201).json(comment);
  });
  app.delete('/api/comments/:id', (req, res) => {
    save(() => {
      const data = db();
      data.comments = data.comments.filter(
        (c) =>
          c.id !== req.params.id ||
          !data.notes.some((n) => n.id === c.note_id && n.user_id === owner(req)),
      );
    });
    res.json({ ok: true });
  });
  // Backup ZIP: backup.json indexes everything; note and revision bodies are HTML files.
  app.get('/api/backup', (req, res) => {
    const user = owner(req),
      notes = db().notes.filter((n) => n.user_id === user),
      ids = new Set(notes.map((n) => n.id)),
      files = db().attachments.filter((a) => ids.has(a.note_id)),
      revisions = db().revisions.filter((r) => ids.has(r.note_id));
    const bytes = files.reduce((sum, f) => sum + f.size, 0);
    if (bytes > 100 * 1024 * 1024)
      throw error(413, '附件总量超过 100MB，请使用 README 中的服务器数据目录备份方式');
    const entries = [];
    const addBody = (kind, id) => {
      const body = store.body(kind, id);
      entries.push([`${kind}/${id}.html`, body.content]);
      if (body.editor_data != null) entries.push([`${kind}/${id}.editor.json`, body.editor_data]);
    };
    for (const n of notes) addBody('notes', n.id);
    for (const r of revisions) addBody('revisions', r.id);
    for (const f of files)
      entries.push([`attachments/${f.id}`, readFileSync(path.join(fileDir, f.id))]);
    const payload = {
      format: 'wixnote',
      version: 2,
      exportedAt: now(),
      folders: db().folders.filter((f) => f.user_id === user),
      tags: db().tags.filter((t) => t.user_id === user),
      notes,
      attachments: files,
      revisions,
      comments: db().comments.filter((c) => ids.has(c.note_id)),
    };
    res.set(
      'Content-Disposition',
      `attachment; filename="wixnote-backup-${now().slice(0, 10)}.zip"`,
    );
    res.type('application/zip').send(writeBackupZip(payload, entries));
  });
  app.post('/api/import', (req, res) => {
    if (!Buffer.isBuffer(req.body) || !req.body.length)
      throw error(400, '请选择本站导出的 ZIP 备份');
    const { data, files } = readBackupZip(req.body),
      user = owner(req),
      written = [];
    if (
      !data ||
      data.format !== 'wixnote' ||
      data.version !== 2 ||
      !Array.isArray(data.notes) ||
      !Array.isArray(data.folders) ||
      !Array.isArray(data.tags)
    )
      throw error(400, '请使用本站导出的 ZIP 备份');
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
    const bodyOf = (kind, item) => {
      const content = files.get(`${kind}/${item.id}.html`) ?? files.get(`${kind}/${item.id}.md`),
        native = files.get(`${kind}/${item.id}.editor.json`);
      if (!allowedTypes.has(item.type)) throw error(400, '备份笔记类型不正确');
      const cleaned = cleanContent(
        rewrite(text(content ? content.toString('utf8') : '', 5_000_000)),
        item.type,
      );
      return [cleaned, native ? storedEditorData(rewrite(native.toString('utf8'))) : null];
    };
    try {
      save(() => {
        const index = db();
        const folders = data.folders.map((f) => ({
          id: mapped('folders', f.id),
          user_id: user,
          parent_id: null,
          name: text(f.name, 100),
          position: Number.isSafeInteger(f.position) ? f.position : 0,
        }));
        validateFolderTree(data.folders);
        data.folders.forEach((f, i) => (folders[i].parent_id = mapped('folders', f.parent_id)));
        index.folders.push(...folders);
        for (const t of data.tags) {
          const name = text(t.name, 100),
            existing = index.tags.find((tag) => tag.user_id === user && tag.name === name);
          if (existing) maps.tags.set(t.id, existing.id);
          else
            index.tags.push({
              id: mapped('tags', t.id),
              user_id: user,
              name,
              color: validColor(t.color) ? t.color : '#7084a4',
            });
        }
        for (const n of data.notes) {
          const [content, native] = bodyOf('notes', n),
            row = {
              id: mapped('notes', n.id),
              user_id: user,
              folder_id: mapped('folders', n.folder_id),
              title: text(n.title, 500),
              type: n.type,
              favorite: !!n.favorite,
              pinned: !!n.pinned,
              deleted_at: n.deleted_at ? now() : null,
              created_at: validDate(n.created_at),
              updated_at: validDate(n.updated_at),
              version: validVersion(n.version),
              share_token: null,
              tags: [],
            };
          index.notes.push(row);
          store.setBody('notes', row.id, content, native);
          setTags(
            row,
            (Array.isArray(n.tags) ? n.tags : []).map((id) => mapped('tags', id)),
            user,
          );
        }
        let total = 0;
        for (const f of data.attachments || []) {
          const bytes = files.get(`attachments/${f.id}`);
          if (!bytes) throw error(400, '备份缺少附件文件');
          total += bytes.length;
          if (total > 100 * 1024 * 1024) throw error(413, '附件备份过大');
          const id = mapped('attachments', f.id);
          writeFileSync(path.join(fileDir, id), bytes, { flag: 'wx' });
          written.push(id);
          index.attachments.push({
            id,
            note_id: mapped('notes', f.note_id),
            name: text(f.name, 500),
            mime: inlineImage(bytes) || 'application/octet-stream',
            size: bytes.length,
            created_at: validDate(f.created_at),
          });
        }
        for (const r of data.revisions || []) {
          const [content, native] = bodyOf('revisions', r),
            id = mapped('revisions', r.id);
          index.revisions.push({
            id,
            note_id: mapped('notes', r.note_id),
            title: text(r.title, 500),
            type: r.type,
            created_at: validDate(r.created_at),
            version: validVersion(r.version),
          });
          store.setBody('revisions', id, content, native);
        }
        for (const c of data.comments || [])
          index.comments.push({
            id: mapped('comments', c.id),
            note_id: mapped('notes', c.note_id),
            body: text(c.body, 10000),
            created_at: validDate(c.created_at),
          });
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
  app.locals.store = store;
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
    process.on(signal, () => server.close(() => process.exit(0)));
}
