#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const usage = `用法：
  node scripts/wixnote-cli.js list [搜索词]
  node scripts/wixnote-cli.js get <笔记 ID>
  node scripts/wixnote-cli.js create <标题> <文件路径|->
  node scripts/wixnote-cli.js update <笔记 ID> <文件路径|->

设置 WIXNOTE_URL 和 WIXNOTE_API_KEY 环境变量。文件和标准输入使用 UTF-8；新建笔记为 Markdown。`;
const [command, ...args] = process.argv.slice(2);
if (!command || command === '--help' || command === '-h') {
  console.log(usage);
  process.exit(0);
}
try {
  if (!process.env.WIXNOTE_URL || !process.env.WIXNOTE_API_KEY)
    throw new Error('请设置 WIXNOTE_URL 和 WIXNOTE_API_KEY');
  const base = new URL(process.env.WIXNOTE_URL);
  if (
    !['http:', 'https:'].includes(base.protocol) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash
  )
    throw new Error('服务地址无效');
  const root = base.href.replace(/\/$/, '');
  async function request(endpoint, method = 'GET', body) {
    const response = await fetch(root + '/api' + endpoint, {
      method,
      headers: {
        Authorization: `Bearer ${process.env.WIXNOTE_API_KEY}`,
        'X-Wix-Request': '1',
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'error',
    });
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${data.error || '请求失败'}`);
    return data;
  }
  async function content(file) {
    if (file !== '-') return readFile(file, 'utf8');
    let value = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) value += chunk;
    return value;
  }
  let result;
  if (command === 'list' && args.length <= 1)
    result = await request('/notes' + (args[0] ? '?q=' + encodeURIComponent(args[0]) : ''));
  else if (command === 'get' && args.length === 1)
    result = await request('/notes/' + encodeURIComponent(args[0]));
  else if (command === 'create' && args.length === 2)
    result = await request('/notes', 'POST', {
      title: args[0],
      type: 'markdown',
      content: await content(args[1]),
    });
  else if (command === 'update' && args.length === 2) {
    const endpoint = '/notes/' + encodeURIComponent(args[0]);
    const existing = await request(endpoint);
    if (existing.type !== 'markdown')
      throw new Error('update 仅支持 Markdown 笔记，避免覆盖富文本或大纲数据');
    result = await request(endpoint, 'PATCH', {
      version: existing.version,
      content: await content(args[1]),
    });
  } else throw new Error(usage);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
