'use strict';

function parseJson(text) {
  if (text !== null && typeof text === 'object' && (Array.isArray(text) || Object.prototype.toString.call(text) === '[object Object]')) {
    return { ok: true, value: text };
  }
  if (text == null || text === '') return { ok: false, error: '响应体为空' };
  try {
    return { ok: true, value: JSON.parse(String(text).replace(/^\uFEFF/, '').trim()) };
  } catch (e) {
    return { ok: false, error: '响应体不是 JSON' };
  }
}

function toJsonPath(parts) {
  let path = '$';
  (parts || []).forEach((part) => {
    if (part === '*') {
      path += '[*]';
      return;
    }
    if (typeof part === 'number') {
      path += `[${part}]`;
      return;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      path += `.${part}`;
      return;
    }
    path += `[${JSON.stringify(String(part))}]`;
  });
  return path;
}

function tokenize(expr) {
  const s = String(expr || '').trim();
  if (!s.startsWith('$')) throw new Error('JSONPath 须以 $ 开头');
  const steps = [];
  let i = 1;
  while (i < s.length) {
    const ch = s[i];
    if (ch === ' ' || ch === '\t') {
      i += 1;
      continue;
    }
    if (ch === '.') {
      if (s[i + 1] === '.') {
        i += 2;
        steps.push({ type: 'recursive' });
        if (i < s.length && /[A-Za-z_]/.test(s[i])) {
          const start = i;
          i += 1;
          while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i += 1;
          steps.push({ type: 'key', key: s.slice(start, i) });
        } else if (s[i] === '*') {
          steps.push({ type: 'wildcard' });
          i += 1;
        }
        continue;
      }
      i += 1;
      if (i >= s.length) throw new Error('JSONPath 语法错误');
      if (s[i] === '*') {
        steps.push({ type: 'wildcard' });
        i += 1;
        continue;
      }
      if (!/[A-Za-z_]/.test(s[i])) throw new Error('JSONPath 语法错误');
      const start = i;
      i += 1;
      while (i < s.length && /[A-Za-z0-9_]/.test(s[i])) i += 1;
      steps.push({ type: 'key', key: s.slice(start, i) });
      continue;
    }
    if (ch === '[') {
      i += 1;
      while (s[i] === ' ') i += 1;
      if (s[i] === '*') {
        steps.push({ type: 'wildcard' });
        i += 1;
      } else if (s[i] === "'" || s[i] === '"') {
        const q = s[i];
        i += 1;
        let key = '';
        while (i < s.length && s[i] !== q) {
          if (s[i] === '\\' && i + 1 < s.length) {
            i += 1;
            key += s[i];
            i += 1;
            continue;
          }
          key += s[i];
          i += 1;
        }
        if (s[i] !== q) throw new Error('JSONPath 引号未闭合');
        i += 1;
        steps.push({ type: 'key', key });
      } else if (/[-0-9]/.test(s[i] || '')) {
        const start = i;
        if (s[i] === '-') i += 1;
        while (i < s.length && /[0-9]/.test(s[i])) i += 1;
        steps.push({ type: 'index', index: Number(s.slice(start, i)) });
      } else {
        throw new Error('JSONPath 括号语法错误');
      }
      while (s[i] === ' ') i += 1;
      if (s[i] !== ']') throw new Error('JSONPath 缺少 ]');
      i += 1;
      continue;
    }
    throw new Error(`JSONPath 无法解析: ${s.slice(i)}`);
  }
  return steps;
}

function collectRecursive(node, out, depth) {
  if (depth > 12 || node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    node.forEach((item) => {
      out.push(item);
      collectRecursive(item, out, depth + 1);
    });
    return;
  }
  Object.keys(node).forEach((key) => {
    out.push(node[key]);
    collectRecursive(node[key], out, depth + 1);
  });
}

function applyStep(nodes, step) {
  const out = [];
  nodes.forEach((node) => {
    if (step.type === 'recursive') {
      collectRecursive(node, out, 0);
      return;
    }
    if (node == null) return;
    if (step.type === 'key') {
      if (Array.isArray(node) || typeof node !== 'object') return;
      if (Object.prototype.hasOwnProperty.call(node, step.key)) out.push(node[step.key]);
      return;
    }
    if (step.type === 'index') {
      if (Array.isArray(node) && step.index >= 0 && step.index < node.length) {
        out.push(node[step.index]);
      }
      return;
    }
    if (step.type === 'wildcard') {
      if (Array.isArray(node)) out.push.apply(out, node);
      else if (typeof node === 'object') {
        Object.keys(node).forEach((key) => out.push(node[key]));
      }
    }
  });
  return out;
}

function stringifyValue(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

function evalJsonPath(root, expr, options) {
  const steps = tokenize(expr);
  let nodes = [root];
  for (let i = 0; i < steps.length; i += 1) {
    nodes = applyStep(nodes, steps[i]);
  }
  if (options && options.unpackArray) {
    const unpacked = [];
    nodes.forEach((node) => {
      if (Array.isArray(node)) unpacked.push.apply(unpacked, node);
      else unpacked.push(node);
    });
    nodes = unpacked;
  }
  return nodes;
}

function formatExtractResult(nodes) {
  if (!nodes || !nodes.length) {
    return { ok: false, error: '未匹配到结果', values: [], preview: '' };
  }
  const values = nodes.map(stringifyValue);
  return {
    ok: true,
    values,
    preview: values.length === 1 ? values[0] : JSON.stringify(values, null, 2)
  };
}

function extractJsonPath(text, expr, options) {
  const parsed = parseJson(text);
  if (!parsed.ok) return parsed;
  try {
    const nodes = evalJsonPath(parsed.value, expr, options);
    return formatExtractResult(nodes);
  } catch (e) {
    return { ok: false, error: e.message || 'JSONPath 执行失败', values: [], preview: '' };
  }
}

function lastPathKey(expr) {
  const s = String(expr || '');
  const quoted = s.match(/\[['"]([^'"]+)['"]\]\s*$/);
  if (quoted) return quoted[1];
  const index = s.match(/\[(\d+|\*)\]\s*$/);
  if (index) return index[1] === '*' ? 'item' : `item${index[1]}`;
  const dot = s.match(/\.([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (dot) return dot[1];
  return 'extracted';
}

module.exports = {
  parseJson,
  toJsonPath,
  tokenize,
  evalJsonPath,
  extractJsonPath,
  formatExtractResult,
  stringifyValue,
  lastPathKey
};
