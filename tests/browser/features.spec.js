import { test, expect } from './fixtures.js';
import AdmZip from 'adm-zip';
import { readFile } from 'node:fs/promises';

test('编辑、刷新恢复、导出及 Markdown 导入', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByLabel('昵称').fill('浏览器测试');
  await page.getByLabel('邮箱').fill('browser@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '创建账户' }).click();
  await page.locator('button.new-note').click();
  const editor = page.frameLocator('iframe[title="编辑器"]');
  const body = editor.getByRole('textbox', { name: '笔记正文' });
  await expect(body).toBeVisible();
  await page.getByLabel('笔记标题').fill('刷新恢复测试');
  await body.click();
  await page.keyboard.insertText('未保存的正文内容');
  await expect(page.getByText('待保存')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wixnote-active-draft')))
    .toBeTruthy();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const id = localStorage.getItem('wixnote-active-draft');
        return JSON.parse(localStorage.getItem('wixnote-draft-' + id) || '{}').content;
      }),
    )
    .toContain('未保存的正文内容');
  page.on('dialog', (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel('笔记标题')).toHaveValue('刷新恢复测试');
  await expect(body).toContainText('未保存的正文内容');
  await expect(page.getByText('待保存')).toBeVisible();
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
  await expect(page.getByLabel('笔记标题')).toHaveAttribute('readonly', '');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('wixnote-active-draft')))
    .toBeNull();
  await page.getByRole('button', { name: '笔记更多操作' }).click();
  const download = page.waitForEvent('download');
  await page.getByText('导出为 Word', { exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('刷新恢复测试.docx');
  const zip = new AdmZip(await readFile(await file.path()));
  const mht = zip.readAsText('word/afchunk.mht');
  expect(mht).toContain('未保存的正文内容');
  expect(mht).toContain('Microsoft YaHei');
  await page.getByRole('button', { name: '笔记更多操作' }).click();
  let popupCount = 0;
  page.on('popup', () => popupCount++);
  const pdfDownload = page.waitForEvent('download');
  await page.getByText('导出为 PDF', { exact: true }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toBe('刷新恢复测试.pdf');
  expect(popupCount).toBe(0);
  await pdf.saveAs(testInfo.outputPath('export.pdf'));
  expect((await readFile(await pdf.path())).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: '查看附件' }).click();
  await expect(page.getByText('暂无附件')).toBeVisible();
  await page.getByRole('button', { name: '选择笔记类型' }).click();
  await page.getByText('导入 Markdown 文件…').click();
  await page.getByLabel('Markdown 文件').setInputFiles({
    name: '导入测试.md',
    mimeType: 'text/markdown',
    buffer: Buffer.from('# 导入正文'),
  });
  await expect(page.getByLabel('笔记标题')).toHaveValue('导入测试');
  await expect(page.frameLocator('iframe[title="编辑器"]').getByRole('textbox')).toContainText(
    '导入正文',
  );
});

test('流程图编辑器完成初始化并可退出', async ({ page }) => {
  await page.route('https://embed.diagrams.net/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body>diagram ready<script>parent.postMessage(JSON.stringify({event:'init'}),'*'); addEventListener('message',e=>{if(JSON.parse(e.data).action==='load') document.body.dataset.loaded='yes'});</script></body></html>`,
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('昵称').fill('流程图测试');
  await page.getByLabel('邮箱').fill('diagram@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '创建账户' }).click();
  await page.locator('button.new-note').click();
  const editor = page.frameLocator('iframe[title="编辑器"]');
  await editor.getByRole('textbox', { name: '笔记正文' }).click();
  await editor.locator('.block-menu-button .add').click({ force: true });
  await editor.getByText('流程图/UML', { exact: true }).click();
  const diagram = editor.locator('.editor-drawio-iframe');
  await expect(diagram).toHaveAttribute('src', /embed\.diagrams\.net/, { timeout: 10000 });
  await expect(editor.locator('.editor-drawio-iframe-container')).not.toHaveClass(/loading/, {
    timeout: 10000,
  });
  await diagram
    .contentFrame()
    .locator('body')
    .evaluate(() => {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>';
      parent.postMessage(
        JSON.stringify({
          event: 'export',
          data: 'data:image/svg+xml;base64,' + btoa(svg),
          message: {},
        }),
        '*',
      );
    });
  await expect(editor.locator('.editor-drawio-iframe-container')).toHaveCount(0);
  await expect(page.getByText('drawio.svg').first()).toBeVisible();
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
  await page.getByRole('button', { name: '编辑笔记' }).click();
  const restored = editor.locator('.editor-drawio-content');
  await expect(restored).toBeVisible();
  await expect
    .poll(() => restored.locator('img').evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBeTruthy();
});

test('流程图服务不可用时退出加载状态并允许继续编辑', async ({ page }) => {
  await page.route('https://embed.diagrams.net/**', (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('昵称').fill('离线测试');
  await page.getByLabel('邮箱').fill('offline@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '创建账户' }).click();
  await page.locator('button.new-note').click();
  const editor = page.frameLocator('iframe[title="编辑器"]');
  await editor.getByRole('textbox', { name: '笔记正文' }).click();
  await editor.locator('.block-menu-button .add').click({ force: true });
  await editor.getByText('流程图/UML', { exact: true }).click();
  await expect(page.getByText('流程图编辑器加载失败，请检查网络后重试')).toBeVisible({
    timeout: 25000,
  });
  await expect(editor.locator('.editor-drawio-iframe-container')).toHaveCount(0);
});
test('Word 导出包含笔记中的附件图片', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('昵称').fill('图片测试');
  await page.getByLabel('邮箱').fill('image@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page.locator('button.new-note')).toBeVisible();
  const headers = { 'X-Wix-Request': '1' };
  const note = await (
    await page.request.post('/api/notes', {
      headers,
      data: { title: '图片导出', type: 'common', content: '<p>图片</p>' },
    })
  ).json();
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  const attachment = await (
    await page.request.post(`/api/notes/${note.id}/attachments`, {
      headers,
      multipart: { file: { name: 'pixel.png', mimeType: 'image/png', buffer: png } },
    })
  ).json();
  const saved = await page.request.patch(`/api/notes/${note.id}`, {
    headers,
    data: {
      version: note.version,
      content: `<p>图片</p><img src="/files/${attachment.id}" alt="测试图片">`,
    },
  });
  expect(saved.ok(), await saved.text()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '打开笔记 图片导出' }).click();
  await page.getByRole('button', { name: '笔记更多操作' }).click();
  const pending = page.waitForEvent('download');
  await page.getByText('导出为 Word', { exact: true }).click();
  const file = await pending;
  const zip = new AdmZip(await readFile(await file.path()));
  const mht = zip.readAsText('word/afchunk.mht');
  expect(mht).toContain('Content-Type: image/png');
  expect(mht).toContain(png.toString('base64'));
  await page.getByRole('button', { name: '笔记更多操作' }).click();
  const pdfPending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '导出为 PDF' }).click();
  const pdfFile = await pdfPending;
  expect((await readFile(await pdfFile.path())).subarray(0, 5).toString()).toBe('%PDF-');
  await page.getByRole('button', { name: '编辑笔记' }).click();
  const body = page.frameLocator('iframe[title="编辑器"]').getByRole('textbox');
  await page
    .frameLocator('iframe[title="编辑器"]')
    .locator('.text-block .block-content')
    .first()
    .click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('更新');
  await expect(body).toContainText('更新');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: '打开笔记 图片导出' }).click();
  await expect(page.frameLocator('iframe[title="编辑器"]').getByRole('textbox')).toContainText(
    '更新',
  );
  const image = page.frameLocator('iframe[title="编辑器"]').locator('img').first();
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((img) => img.complete && img.naturalWidth > 0))
    .toBeTruthy();
});

test('长笔记直接导出为多页 PDF', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '注册', exact: true }).click();
  await page.getByLabel('昵称').fill('长文测试');
  await page.getByLabel('邮箱').fill('longpdf@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page.locator('button.new-note')).toBeVisible();
  const content = Array.from(
    { length: 80 },
    (_, i) => `<p>第 ${i + 1} 段：用于验证中文段落和分页的内容，包含标点符号与数字。</p>`,
  ).join('');
  const response = await page.request.post('/api/notes', {
    headers: { 'X-Wix-Request': '1' },
    data: { title: '长文导出', type: 'common', content },
  });
  expect(response.ok()).toBeTruthy();
  await page.reload();
  await page.getByRole('button', { name: '打开笔记 长文导出' }).click();
  await page.getByRole('button', { name: '笔记更多操作' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '导出为 PDF' }).click();
  const pdf = await pending;
  const data = await readFile(await pdf.path());
  expect(data.subarray(0, 5).toString()).toBe('%PDF-');
  expect((data.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
});
