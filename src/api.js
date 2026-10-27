export async function api(url, options = {}) {
  const body = options.body;
  const response = await fetch('/api' + url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'X-Wix-Request': '1',
      ...(body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...options.headers,
    },
    body: body == null ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ error: '服务器返回了无效响应' }));
  if (!response.ok)
    throw Object.assign(new Error(data.error || '请求失败'), { status: response.status });
  return data;
}
export function download(name, value, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function date(value) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return '—';
  const pad = (part) => String(part).padStart(2, '0');
  return (
    `${timestamp.getFullYear()}/${pad(timestamp.getMonth() + 1)}/${pad(timestamp.getDate())} ` +
    `${pad(timestamp.getHours())}:${pad(timestamp.getMinutes())}`
  );
}
export function timeAgo(value, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - new Date(value).getTime()) / 1000));
  if (!Number.isFinite(seconds)) return '未知时间';
  if (seconds < 1) return '刚刚';
  for (const [duration, unit] of [
    [86400, '天'],
    [3600, '小时'],
    [60, '分钟'],
    [1, '秒'],
  ]) {
    if (seconds >= duration) return `${Math.floor(seconds / duration)} ${unit}前`;
  }
}
export const bytes = (value) =>
  value < 1024
    ? value + ' B'
    : value < 1048576
      ? (value / 1024).toFixed(1) + ' KB'
      : (value / 1048576).toFixed(1) + ' MB';
