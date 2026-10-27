import { test as base, expect } from '@playwright/test';
export { expect };
export const test = base.extend({
  page: async ({ page, context }, use, testInfo) => {
    const errors = [];
    const expectedFailure = testInfo.title.includes('服务不可用');
    const watch = (target) => {
      target.on('pageerror', (error) => errors.push('pageerror: ' + error.message));
      target.on('console', (message) => {
        if (message.type() === 'error' && !(expectedFailure && message.text().includes('503')))
          errors.push('console: ' + message.text());
      });
      target.on('requestfailed', (request) => {
        const failure = request.failure()?.errorText || '';
        if (!failure.includes('ERR_ABORTED'))
          errors.push('request: ' + request.url() + ' ' + failure);
      });
      target.on('response', (response) => {
        if (
          response.status() >= 400 &&
          !(expectedFailure && response.url().startsWith('https://embed.diagrams.net/'))
        )
          errors.push('HTTP ' + response.status() + ' ' + response.url());
      });
    };
    watch(page);
    context.on('page', watch);
    await use(page);
    expect(errors, '浏览器异常、控制台错误或失败请求').toEqual([]);
  },
});
