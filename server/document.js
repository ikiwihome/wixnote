const invalid = (message) => Object.assign(new Error(message), { status: 400 });

// Persist native LiveEditor blocks without interpreting them as executable HTML.
export function editorData(value) {
  if (value == null) return null;
  if (typeof value === 'string') {
    if (value.length > 5_000_000) throw invalid('编辑器文档过大');
    try {
      value = JSON.parse(value);
    } catch {
      throw invalid('编辑器文档 JSON 无效');
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.blocks))
    throw invalid('编辑器文档必须包含 blocks');
  if (value.blocks.length > 20000) throw invalid('编辑器块数量过多');
  for (const block of value.blocks) {
    if (
      !block ||
      typeof block !== 'object' ||
      Array.isArray(block) ||
      typeof block.id !== 'string' ||
      !block.id ||
      block.id.length > 200 ||
      typeof block.type !== 'string' ||
      !block.type ||
      block.type.length > 100
    )
      throw invalid('编辑器块结构无效');
  }
  let count = 0;
  const stack = [[value, 0]];
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (++count > 150000 || depth > 64) throw invalid('编辑器文档结构过于复杂');
    if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key))
          throw invalid('编辑器文档包含无效属性');
        stack.push([child, depth + 1]);
      }
    }
  }
  if (JSON.stringify(value).length > 5_000_000) throw invalid('编辑器文档过大');
  return value;
}
export const storedEditorData = (value) => {
  const document = editorData(value);
  return document === null ? null : JSON.stringify(document);
};

export function rewriteResources(value, mapping) {
  return value.replace(
    /(\/files\/|wix-resource:)([a-f0-9-]{36})/g,
    (_match, prefix, id) => prefix + (mapping.get(id) || id),
  );
}
