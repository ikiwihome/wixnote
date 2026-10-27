import { test, expect } from './fixtures.js';
import { readFile } from 'node:fs/promises';

async function register(page, id) {
  await page.goto('/');
  const registerTab = page.getByRole('button', { name: '注册', exact: true });
  if (await registerTab.isVisible()) await registerTab.click();
  await page.getByLabel('昵称').fill('测试用户' + id);
  await page.getByLabel('邮箱').fill(id + '@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '创建账户' }).click();
  await expect(page.locator('button.new-note')).toBeVisible();
}
async function create(page, title, content = '') {
  await page.locator('button.new-note').click();
  await page.getByLabel('笔记标题').fill(title);
  const body = page.frameLocator('iframe[title="编辑器"]').getByRole('textbox');
  await expect(body).toBeVisible();
  if (content) {
    await body.click();
    await page.keyboard.insertText(content);
  }
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
}
async function menu(page, label) {
  await page.getByRole('button', { name: '笔记更多操作' }).click();
  await page.getByRole('menuitem', { name: label, exact: true }).click();
}
async function closeDialog(page) {
  await page.getByRole('dialog').getByRole('button', { name: '关闭对话框' }).click();
}

test('文件夹、标签、搜索、收藏、置顶、复制及回收站', async ({ page }) => {
  await register(page, 'organize');
  await page.getByRole('button', { name: '新建文件夹' }).click();
  await page.getByLabel('文件夹名称').fill('项目文件夹');
  await page.getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('项目文件夹', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建标签' }).click();
  await page.getByLabel('标签名称').fill('测试标签');
  await page.getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('测试标签', { exact: true })).toBeVisible();
  await page.getByText('项目文件夹', { exact: true }).click();
  await create(page, '检索测试笔记', '检索正文关键词');
  await page.getByRole('button', { name: '收藏笔记' }).click();
  await page.getByRole('button', { name: '编辑笔记' }).click();
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '取消收藏' })).toBeVisible();
  await menu(page, '置顶笔记');
  await expect(
    page.getByRole('button', { name: '打开笔记 检索测试笔记' }).locator('.favorite-star'),
  ).toBeVisible();
  await page.getByRole('button', { name: '个人笔记', exact: true }).click();
  await page.getByLabel('搜索笔记').fill('检索正文关键词');
  await expect(page.getByRole('button', { name: '打开笔记 检索测试笔记' })).toBeVisible();
  await page.getByLabel('搜索笔记').fill('');
  await page.getByRole('button', { name: '我的收藏' }).click();
  await expect(page.getByRole('button', { name: '打开笔记 检索测试笔记' })).toBeVisible();
  await page.getByRole('button', { name: '个人笔记', exact: true }).click();
  await menu(page, '创建副本');
  await expect(page.getByText('已创建副本')).toBeVisible();
  await menu(page, '移到回收站');
  await page.getByRole('button', { name: '回收站', exact: false }).click();
  await expect(page.getByRole('button', { name: /打开笔记 检索测试笔记/ })).toBeVisible();
  await page.getByRole('button', { name: '恢复笔记', exact: true }).click();
  await page.getByRole('button', { name: '个人笔记', exact: true }).click();
  await expect(page.getByRole('button', { name: /打开笔记 检索测试笔记/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '测试标签标签菜单' }).click();
  await page.getByRole('menuitem', { name: '重命名标签' }).click();
  await page.getByLabel('标签名称').fill('新标签');
  await page.getByRole('button', { name: '确定' }).click();
  await expect(page.getByText('新标签', { exact: true })).toBeVisible();
});

test('历史、评论、分享及附件上传删除', async ({ page, context }) => {
  await register(page, 'collaboration');
  await create(page, '协作测试', '第一版内容');
  await page.getByRole('button', { name: '编辑笔记' }).click();
  await page.getByLabel('笔记标题').fill('协作测试第二版');
  await page.getByRole('button', { name: '查看附件' }).click();
  await page
    .getByLabel('附件文件')
    .setInputFiles({ name: '说明.txt', mimeType: 'text/plain', buffer: Buffer.from('附件内容') });
  await expect(page.getByText('附件已上传')).toBeVisible();
  await expect(page.getByRole('link', { name: /说明.txt/ }).first()).toBeVisible();
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
  await page.getByRole('button', { name: '评论' }).click();
  await page.getByLabel('评论内容').fill('一条评论');
  await page.getByRole('button', { name: '发表评论' }).click();
  await expect(page.getByText('一条评论')).toBeVisible();
  await page.getByRole('button', { name: '删除评论' }).click();
  await expect(page.getByText('一条评论')).toHaveCount(0);
  await closeDialog(page);
  await page.getByRole('button', { name: '分享笔记' }).click();
  await page.getByRole('button', { name: '创建分享链接' }).click();
  const url = await page.getByLabel('分享链接').inputValue();
  const publicPage = await context.newPage();
  await publicPage.goto(url);
  await expect(publicPage.getByRole('heading', { name: '协作测试第二版' })).toBeVisible();
  await expect(publicPage.getByText('第一版内容')).toBeVisible();
  await publicPage.close();
  await page.getByRole('button', { name: '取消分享' }).click();
  await expect(page.getByRole('button', { name: '创建分享链接' })).toBeVisible();
  await closeDialog(page);
  await menu(page, '历史版本');
  await expect(
    page.getByRole('dialog', { name: '历史版本' }).getByText('协作测试', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '恢复此版本' }).click();
  await expect(page.getByLabel('笔记标题')).toHaveValue('协作测试');
  await page.getByRole('button', { name: '删除附件 说明.txt' }).click();
  await page
    .getByRole('dialog', { name: '删除附件' })
    .getByRole('button', { name: '确定' })
    .click();
  await expect(page.getByRole('link', { name: /说明.txt/ })).toHaveCount(0);
});

test('模板、大纲、设置、备份和退出登录', async ({ page }) => {
  await register(page, 'settings');
  await page.getByRole('button', { name: '选择笔记类型' }).click();
  await page.getByRole('menuitem', { name: '从模板新建…' }).click();
  await page.getByRole('button', { name: /会议纪要/ }).click();
  await expect(page.getByLabel('笔记标题')).toHaveValue('会议纪要');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await page.getByRole('button', { name: '选择笔记类型' }).click();
  await page.getByRole('menuitem', { name: '新建大纲笔记' }).click();
  await expect(page.frameLocator('iframe[title="编辑器"]').getByRole('textbox')).toBeVisible();
  await page.getByRole('button', { name: '保存笔记' }).click();
  await page.locator('.account-button').click();
  await page.getByRole('menuitem', { name: '设置' }).click();
  await page.getByRole('button', { name: '阅读与外观' }).click();
  await page.getByLabel('主题').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByLabel('正文字号').selectOption('18');
  await page.getByRole('dialog', { name: '设置' }).getByLabel('笔记列表').selectOption('compact');
  await page.getByRole('button', { name: '数据管理' }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).click();
  const backup = await pending;
  expect(backup.suggestedFilename()).toMatch(/\.json$/);
  await expect(page.getByText('备份已导出')).toBeVisible();
  const backupData = await readFile(await backup.path());
  await page
    .getByRole('dialog', { name: '设置' })
    .locator('input[type=file]')
    .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupData });
  await expect(page.getByText(/已导入 \d+ 篇笔记/)).toBeVisible();
  await page.getByRole('button', { name: '快捷键' }).click();
  await expect(page.getByText('Ctrl / ⌘ + S')).toBeVisible();
  await closeDialog(page);
  await page.locator('.account-button').click();
  await page.getByRole('menuitem', { name: '退出登录' }).click();
  await expect(page.getByRole('button', { name: '登录', exact: true }).last()).toBeVisible();
  await page.getByLabel('邮箱').fill('settings@example.com');
  await page.getByLabel('密码').fill('password12345');
  await page.getByRole('button', { name: '登录', exact: true }).last().click();
  await expect(page.locator('button.new-note')).toBeVisible();
});

test('其他导出格式、笔记信息、专注模式及目录管理', async ({ page }) => {
  await register(page, 'exports');
  await create(page, '格式测试', '文本格式内容');
  for (const [label, extension] of [
    ['Markdown', '.md'],
    ['HTML', '.html'],
    ['纯文本', '.txt'],
  ]) {
    await page.getByRole('button', { name: '笔记更多操作' }).click();
    const pending = page.waitForEvent('download');
    await page
      .getByRole('menuitem', { name: '导出为' + (label === '纯文本' ? '' : ' ') + label })
      .click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe('格式测试' + extension);
    expect((await readFile(await download.path())).toString()).toContain('文本格式内容');
  }
  await page.getByRole('button', { name: '笔记详细信息' }).click();
  await expect(page.getByText('版本', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭侧栏' }).click();
  await menu(page, '专注模式');
  await expect(page.getByRole('button', { name: '退出专注模式' })).toBeVisible();
  await page.getByRole('button', { name: '退出专注模式' }).click();
  await page.getByRole('button', { name: '排序与视图' }).click();
  await page.getByRole('menuitem', { name: '按标题' }).click();
  await page.getByRole('button', { name: '新建文件夹' }).click();
  await page.getByLabel('文件夹名称').fill('待处理目录');
  await page.getByRole('button', { name: '确定' }).click();
  await page.getByRole('button', { name: '待处理目录菜单' }).click();
  await page.getByRole('menuitem', { name: '重命名' }).click();
  await page.getByLabel('文件夹名称').fill('已重命名目录');
  await page.getByRole('button', { name: '确定' }).click();
  await page.getByRole('button', { name: '已重命名目录菜单' }).click();
  await page.getByRole('menuitem', { name: '删除文件夹' }).click();
  await page
    .getByRole('dialog', { name: '删除文件夹' })
    .getByRole('button', { name: '确定' })
    .click();
  await expect(page.getByRole('button', { name: '已重命名目录菜单' })).toHaveCount(0);
  await page.getByRole('button', { name: '新建标签' }).click();
  await page.getByLabel('标签名称').fill('待删除标签');
  await page.getByRole('button', { name: '确定' }).click();
  await page.getByRole('button', { name: '待删除标签标签菜单' }).click();
  await page.getByRole('menuitem', { name: '删除标签' }).click();
  await page
    .getByRole('dialog', { name: '删除标签' })
    .getByRole('button', { name: '确定' })
    .click();
  await expect(page.getByText('待删除标签', { exact: true })).toHaveCount(0);
});

test('窄屏导航和笔记编辑', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await register(page, 'mobile');
  await page.locator('button.new-note').click();
  await page.getByLabel('笔记标题').fill('手机笔记');
  const body = page.frameLocator('iframe[title="编辑器"]').getByRole('textbox');
  await body.click();
  await page.keyboard.insertText('手机端内容');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.getByRole('button', { name: '编辑笔记' })).toBeVisible();
  await page.getByRole('button', { name: '返回笔记列表' }).click();
  await expect(page.getByRole('button', { name: '打开笔记 手机笔记' })).toBeVisible();
  await page.getByRole('button', { name: '打开导航栏' }).click();
  await expect(page.getByRole('button', { name: '关闭导航栏' })).toBeVisible();
  await page.getByRole('button', { name: '关闭导航栏' }).click({ position: { x: 380, y: 400 } });
  await page.getByRole('button', { name: '打开笔记 手机笔记' }).click();
  await expect(page.getByLabel('笔记标题')).toHaveValue('手机笔记');
});
