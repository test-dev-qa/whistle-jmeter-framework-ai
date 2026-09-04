const { normalizeHeaders, getHeader } = require('./utils');
const { toJmeterExtractor, resolveItemValue } = require('./extractVars');

const TOKEN_KEYS = [
  'access_token',
  'accesstoken',
  'access-token',
  'id_token',
  'idtoken',
  'auth_token',
  'authtoken',
  'authorization',
  'token',
  'jwt'
];

const REFRESH_TOKEN_KEYS = ['refresh_token', 'refreshtoken', 'refresh-token'];
const TOKEN_KEY_RANK = new Map(TOKEN_KEYS.map((key, index) => [key, index]));
const REFRESH_KEY_RANK = new Map(REFRESH_TOKEN_KEYS.map((key, index) => [key, 100 + index]));

const CURSOR_KEY_RE = /^(cursor|nexttoken|next_token|pagetoken|page_token|nextcursor|next_cursor|lastid|last_id|offset|nextid|next_id|pageindex|page_index|pagetoken)$/i;

const SKIP_KEY_RE = /^(msg|message|errormsg|errmsg|error_msg|success|code|status|statuscode|type|method|path|url|contenttype|content_type|timestamp|time|date|createdat|updatedat|msginfo|hint|desc|description|sign|signature|nonce|ts|requestid|request_id|reqid|random|salt|hash|secret)$/i;

const SKIP_SUB_HEADER_RE = /^(content-type|accept|accept-language|accept-encoding|user-agent|origin|sec-|cache-control|pragma|upgrade-insecure-requests|dnt|date|server|connection|content-length|vary|via)$/i;

const JWT_CLAIM_KEYS = /^(sub|uid|userid|user_id|tenantid|tenant_id|accountid|account_id|openid|open_id)$/i;

const MAX_EXTRACTORS_PER_RECORD = 8;
const MAX_VARS = 40;
const MAX_ID_CANDIDATES = 24;

function lowerKey(key) {
  return String(key || '').toLowerCase();
}

function isTokenKey(key) {
  return TOKEN_KEY_RANK.has(lowerKey(key));
}

function isRefreshTokenKey(key) {
  return REFRESH_KEY_RANK.has(lowerKey(key));
}

function isCursorKey(key) {
  return CURSOR_KEY_RE.test(key);
}

function isTokenValue(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 16) return false;
  if (/^(true|false|null|undefined|success|failed|error|ok)$/i.test(v)) return false;
  if (/\s/.test(v) && v.length < 48) return false;
  return true;
}

function keyRank(key) {
  const lk = lowerKey(key);
  if (REFRESH_KEY_RANK.has(lk)) return REFRESH_KEY_RANK.get(lk);
  if (TOKEN_KEY_RANK.has(lk)) return TOKEN_KEY_RANK.get(lk);
  if (isCursorKey(key)) return 200;
  return 300;
}

function toJsonPath(parts) {
  let path = '$';
  for (const part of parts) {
    if (typeof part === 'number') {
      path += `[${part}]`;
    } else if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(part)) {
      path += `.${part}`;
    } else {
      path += `[${JSON.stringify(part)}]`;
    }
  }
  return path;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tryParseNestedJson(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length < 2 || trimmed.length > 200000) return null;
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))
    && !(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    return null;
  }
}

function isUsefulCandidate(key, value) {
  if (SKIP_KEY_RE.test(key)) return false;
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) return false;
    if (isCursorKey(key)) return value >= 0;
    if (Math.abs(value) < 10) return false;
    if (Math.abs(value) < 1000 && !/(^id$|id$|_id$|no$|_no$)/i.test(key) && !isCursorKey(key)) {
      return false;
    }
    return true;
  }
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (isCursorKey(key) && v.length >= 1 && v.length <= 512) return !/\s/.test(v);
  if (v.length < 6 || v.length > 512) return false;
  if (/^(true|false|null|undefined|success|failed|error|ok|get|post|put|patch|delete)$/i.test(v)) return false;
  if (/\s/.test(v)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return false;
  if (/^(application|text|image|multipart)\//i.test(v)) return false;
  return true;
}

function regexForJsonField(key, value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value))) {
    return `"${escapeRegExp(key)}"\\s*:\\s*(\\d+)`;
  }
  return `"${escapeRegExp(key)}"\\s*:\\s*"([^"]+)"`;
}

function walkLeaves(node, parts, hits, depth, nestedString) {
  if (depth > 8 || node == null) return;
  if (Array.isArray(node)) {
    const limit = Math.min(node.length, 30);
    for (let i = 0; i < limit; i += 1) {
      walkLeaves(node[i], parts.concat(i), hits, depth + 1, nestedString);
    }
    return;
  }
  if (typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object') {
      walkLeaves(value, parts.concat(key), hits, depth + 1, nestedString);
      continue;
    }
    const nested = tryParseNestedJson(value);
    if (nested) {
      walkLeaves(nested, parts.concat(key), hits, depth + 1, true);
      continue;
    }
    const tokenish = (isTokenKey(key) || isRefreshTokenKey(key)) && isTokenValue(value);
    if (isUsefulCandidate(key, value) || tokenish) {
      const numeric = typeof value === 'number';
      hits.push({
        key,
        value: numeric ? String(value) : String(value).trim(),
        jsonPath: nestedString ? '' : toJsonPath(parts.concat(key)),
        regex: nestedString ? regexForJsonField(key, value) : undefined,
        type: nestedString ? 'regex' : 'json',
        rank: keyRank(key),
        isToken: isTokenKey(key) && isTokenValue(value),
        isRefresh: isRefreshTokenKey(key) && isTokenValue(value),
        isCursor: isCursorKey(key),
        kind: isRefreshTokenKey(key) && isTokenValue(value)
          ? 'refreshToken'
          : (isTokenKey(key) && isTokenValue(value)
            ? 'token'
            : (isCursorKey(key) ? 'cursor' : 'id')),
        nestedString: Boolean(nestedString)
      });
    }
  }
}

function parseLeaves(body) {
  if (!body || typeof body !== 'string') return [];
  const trimmed = body.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return [];
  let json;
  try {
    json = JSON.parse(trimmed);
  } catch (e) {
    return [];
  }
  const hits = [];
  walkLeaves(json, [], hits, 0, false);
  return hits;
}

function findHtmlCsrf(body) {
  if (!body || typeof body !== 'string' || body.indexOf('<') === -1) return null;
  const patterns = [
    {
      re: /<meta[^>]+name=["']csrf-token["'][^>]*content=["']([^"']{8,})["']/i,
      regex: '<meta[^>]+name="csrf-token"[^>]*content="([^"]+)"'
    },
    {
      re: /<input[^>]+name=["'](_csrf|csrfToken|csrf_token|authenticity_token)["'][^>]*value=["']([^"']{8,})["']/i,
      group: 2,
      regex: '<input[^>]+name="(?:_csrf|csrfToken|csrf_token|authenticity_token)"[^>]*value="([^"]+)"'
    },
    {
      re: /<input[^>]+value=["']([^"']{8,})["'][^>]+name=["'](_csrf|csrfToken|csrf_token|authenticity_token)["']/i,
      group: 1,
      regex: '<input[^>]+value="([^"]+)"[^>]+name="(?:_csrf|csrfToken|csrf_token|authenticity_token)"'
    }
  ];
  for (const pattern of patterns) {
    const match = body.match(pattern.re);
    if (!match) continue;
    const value = String(pattern.group ? match[pattern.group] : match[1]).trim();
    if (value.length >= 8) {
      return { key: 'csrfToken', value, regex: pattern.regex, type: 'regex', kind: 'csrf' };
    }
  }
  return null;
}

function parseFormHits(body) {
  if (!body || typeof body !== 'string') return [];
  const trimmed = body.trim();
  if (!trimmed || trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.startsWith('<')) return [];
  if (trimmed.indexOf('=') === -1) return [];
  if (trimmed.length > 20000) return [];
  const hits = [];
  trimmed.split('&').forEach((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 1) return;
    let key = pair.slice(0, eq);
    let value = pair.slice(eq + 1);
    try {
      key = decodeURIComponent(key.replace(/\+/g, ' '));
      value = decodeURIComponent(value.replace(/\+/g, ' '));
    } catch (e) {
      return;
    }
    const tokenish = (isTokenKey(key) || isRefreshTokenKey(key)) && isTokenValue(value);
    if (!isUsefulCandidate(key, value) && !tokenish) return;
    hits.push({
      key,
      value: String(value).trim(),
      type: 'regex',
      regex: `(?:^|&)${escapeRegExp(key)}=([^&]+)`,
      rank: keyRank(key),
      isToken: isTokenKey(key) && isTokenValue(value),
      isRefresh: isRefreshTokenKey(key) && isTokenValue(value),
      kind: tokenish ? (isRefreshTokenKey(key) ? 'refreshToken' : 'token') : 'form'
    });
  });
  return hits.slice(0, 20);
}

function parseXmlHits(body) {
  if (!body || typeof body !== 'string' || body.indexOf('<') === -1) return [];
  if (/<html[\s>]|<body[\s>]/i.test(body)) return [];
  const hits = [];
  const re = /<([A-Za-z_][\w:.-]*)>([^<]{6,256})<\/\1>/g;
  let match;
  while ((match = re.exec(body))) {
    const key = match[1].replace(/^.*:/, '');
    const value = String(match[2] || '').trim();
    const tokenish = (isTokenKey(key) || isRefreshTokenKey(key)) && isTokenValue(value);
    if (!isUsefulCandidate(key, value) && !tokenish) continue;
    hits.push({
      key,
      value,
      type: 'regex',
      regex: `<${escapeRegExp(match[1])}>\\s*([^<]+)\\s*</${escapeRegExp(match[1])}>`,
      rank: keyRank(key),
      isToken: isTokenKey(key) && isTokenValue(value),
      isRefresh: isRefreshTokenKey(key) && isTokenValue(value),
      kind: tokenish ? (isRefreshTokenKey(key) ? 'refreshToken' : 'token') : 'xml'
    });
    if (hits.length >= 20) break;
  }
  return hits;
}

function parseLocationHits(headers) {
  const loc = getHeader(headers, 'location');
  if (!loc) return [];
  let parsed;
  try {
    parsed = new URL(String(loc), 'http://local.invalid');
  } catch (e) {
    return [];
  }
  const hits = [];
  parsed.searchParams.forEach((value, key) => {
    if (!value) return;
    const useful = isUsefulCandidate(key, value) || /^(code|ticket|state|authcode|auth_code)$/i.test(key);
    if (!useful) return;
    hits.push({
      key,
      value: String(value).trim(),
      type: 'regex',
      useHeaders: true,
      regex: `[?&]${escapeRegExp(key)}=([^&\\s]+)`,
      rank: keyRank(key),
      kind: 'location'
    });
  });
  return hits;
}

function parseHeaderHits(headers) {
  const hits = parseLocationHits(headers);
  Object.keys(headers || {}).forEach((key) => {
    const lower = key.toLowerCase();
    if (lower === 'location' || lower === 'set-cookie' || SKIP_SUB_HEADER_RE.test(lower)) return;
    const value = String(headers[key] == null ? '' : headers[key]).trim();
    if (!value || value.length > 512) return;
    const tokenish = (isTokenKey(key) || isRefreshTokenKey(key) || /token$/i.test(key)) && isTokenValue(value);
    if (!tokenish && !isCursorKey(key) && !(value.length >= 8 && !/\s/.test(value) && /id|token|cursor|request/i.test(key))) {
      return;
    }
    if (SKIP_KEY_RE.test(key.replace(/-/g, ''))) return;
    hits.push({
      key: key.replace(/-/g, ''),
      value,
      type: 'regex',
      useHeaders: true,
      regex: `${escapeRegExp(key)}:\\s*([^\\r\\n]+)`,
      rank: keyRank(key),
      isToken: tokenish && !isRefreshTokenKey(key),
      isRefresh: isRefreshTokenKey(key),
      kind: 'header'
    });
  });
  return hits;
}

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length < 2) return null;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload && typeof payload === 'object' ? payload : null;
  } catch (e) {
    return null;
  }
}

function jwtClaimHits(tokenValue) {
  const payload = decodeJwtPayload(tokenValue);
  if (!payload) return [];
  const hits = [];
  Object.keys(payload).forEach((key) => {
    if (!JWT_CLAIM_KEYS.test(key)) return;
    const value = payload[key];
    if (value == null || typeof value === 'object') return;
    const text = String(value).trim();
    if (text.length < 2 || text.length > 128) return;
    hits.push({
      key,
      value: text,
      kind: 'jwtClaim',
      exportable: false,
      note: 'JWT 声明需在脚本中解码，未自动生成提取器'
    });
  });
  return hits;
}

function findToken(body) {
  const tokens = parseLeaves(body).filter((item) => item.isToken);
  if (!tokens.length) return null;
  tokens.sort((a, b) => a.rank - b.rank || b.value.length - a.value.length);
  return tokens[0];
}

function appearsIn(haystack, value) {
  const s = String(haystack || '');
  const v = String(value);
  if (!v || !s) return false;
  if (v.length >= 12) return s.includes(v);
  const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRegExp(v)}(?:$|[^A-Za-z0-9])`);
  return re.test(s);
}

function substituteOne(str, value, varName) {
  const src = String(str == null ? '' : str);
  const v = String(value);
  if (!v || !src) return src;
  const replacement = `\${${varName}}`;
  if (v.length >= 12) {
    return src.includes(v) ? src.split(v).join(replacement) : src;
  }
  const re = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(v)}($|[^A-Za-z0-9])`, 'g');
  return src.replace(re, `$1${replacement}$2`);
}

function substitute(str, tokens) {
  if (str == null || str === '' || !tokens.length) return str == null ? '' : String(str);
  let out = String(str);
  const sorted = tokens.slice().sort((a, b) => b.value.length - a.value.length);
  for (const token of sorted) {
    out = substituteOne(out, token.value, token.varName);
  }
  return out;
}

function encodeQueryValue(value) {
  if (value.includes('${')) return value;
  return encodeURIComponent(value);
}

function substituteQuery(search, tokens) {
  if (!search || !tokens.length) return search || '';
  return search.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq === -1) return substitute(pair, tokens);
    const name = pair.slice(0, eq);
    let raw = pair.slice(eq + 1);
    let decoded = raw;
    try {
      decoded = decodeURIComponent(raw.replace(/\+/g, ' '));
    } catch (e) {
      decoded = raw;
    }
    const next = substitute(decoded, tokens);
    if (next === decoded) return pair;
    return `${name}=${encodeQueryValue(next)}`;
  }).join('&');
}

function substitutePath(path, tokens) {
  const src = String(path || '');
  const q = src.indexOf('?');
  if (q === -1) return substitute(src, tokens);
  return `${substitute(src.slice(0, q), tokens)}?${substituteQuery(src.slice(q + 1), tokens)}`;
}

function requestPath(record) {
  try {
    const parsed = new URL(record.url);
    return (parsed.pathname || '/') + parsed.search;
  } catch (e) {
    return record.url || '';
  }
}

function requestBlob(record) {
  const headers = normalizeHeaders(record.requestHeaders || record.headers || {});
  const body = record.requestBody != null && record.requestBody !== ''
    ? String(record.requestBody)
    : String(record.body || '');
  const fields = ((record.multipart && record.multipart.fields) || [])
    .map((field) => String(field.value || ''))
    .join('\n');
  return `${requestPath(record)}\n${body}\n${fields}\n${JSON.stringify(headers)}`;
}

function sanitizeVarName(key, used) {
  let name = String(key || 'var').replace(/[^A-Za-z0-9_]/g, '_');
  if (!/^[A-Za-z_]/.test(name)) name = `var_${name}`;
  if (name.length > 40) name = name.slice(0, 40);
  let candidate = name;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${name}_${i}`;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function nextTokenName(count) {
  return count === 0 ? 'authToken' : `authToken_${count + 1}`;
}

function nextRefreshName(count) {
  return count === 0 ? 'refreshToken' : `refreshToken_${count + 1}`;
}

function blobHasValue(blobs, start, end, value) {
  for (let i = start; i < end; i += 1) {
    if (appearsIn(blobs[i], value)) return true;
  }
  return false;
}

function collectHits(record) {
  const body = record.responseBody || '';
  const headers = normalizeHeaders(record.responseHeaders || {});
  return []
    .concat(parseLeaves(body))
    .concat(parseFormHits(body))
    .concat(parseXmlHits(body))
    .concat(parseHeaderHits(headers));
}

function findUses(list, varItem) {
  const uses = [];
  for (let i = varItem.sourceIndex + 1; i < list.length; i += 1) {
    const rec = list[i];
    const fields = [];
    const headers = normalizeHeaders(rec.requestHeaders || rec.headers || {});
    Object.keys(headers).forEach((key) => {
      if (SKIP_SUB_HEADER_RE.test(key)) return;
      if (appearsIn(headers[key], varItem.value)) fields.push(`header:${key}`);
    });
    const body = rec.requestBody != null && rec.requestBody !== ''
      ? String(rec.requestBody)
      : String(rec.body || '');
    if (appearsIn(body, varItem.value)) fields.push('body');
    ((rec.multipart && rec.multipart.fields) || []).forEach((field) => {
      if (appearsIn(field.value, varItem.value)) fields.push(`multipart:${field.name || 'field'}`);
    });
    try {
      const parsed = new URL(rec.url);
      if (appearsIn(parsed.pathname, varItem.value)) fields.push('path');
      parsed.searchParams.forEach((value, key) => {
        if (appearsIn(value, varItem.value)) fields.push(`query:${key}`);
      });
    } catch (e) {
      if (appearsIn(rec.url, varItem.value)) fields.push('url');
    }
    if (fields.length) {
      uses.push({
        index: i,
        method: rec.method || 'GET',
        url: rec.url || '',
        fields
      });
    }
  }
  return uses;
}

function applyCorrelateEdits(vars, edits) {
  if (!edits || typeof edits !== 'object') return vars;
  const disabled = new Set((edits.disabled || []).map(String));
  const rename = edits.rename && typeof edits.rename === 'object' ? edits.rename : {};
  const jsonPath = edits.jsonPath && typeof edits.jsonPath === 'object' ? edits.jsonPath : {};
  const regex = edits.regex && typeof edits.regex === 'object' ? edits.regex : {};
  return vars.filter((item) => !disabled.has(String(item.id)) && !disabled.has(item.varName)).map((item) => {
    const next = { ...item, enabled: true };
    if (rename[item.id] || rename[item.varName]) {
      next.varName = String(rename[item.id] || rename[item.varName]).replace(/[^A-Za-z0-9_]/g, '_') || item.varName;
    }
    if (jsonPath[item.id] || jsonPath[item.varName]) {
      next.jsonPath = String(jsonPath[item.id] || jsonPath[item.varName]);
      if (next.jsonPath) next.type = next.type === 'regex' && next.useHeaders ? next.type : 'json';
    }
    if (regex[item.id] || regex[item.varName]) {
      next.regex = String(regex[item.id] || regex[item.varName]);
    }
    return next;
  });
}

function correlateTokens(records, options) {
  const list = records || [];
  const blobs = list.map(requestBlob);
  const extractorsByIndex = list.map(() => []);
  const vars = [];
  const valueSet = new Set();
  const usedNames = new Set();
  let tokenCount = 0;
  let refreshCount = 0;
  const jwtNotes = [];
  const autoCorrelate = !options || options.autoCorrelate !== false;
  const manualsByIndex = (options && options.manualExtractors) || [];

  (manualsByIndex || []).forEach((items, index) => {
    if (!list[index]) return;
    (items || []).forEach((item) => {
      if (!item || item.enabled === false) return;
      const varName = sanitizeVarName(item.varName || 'extracted', usedNames);
      const resolved = resolveItemValue(list[index], item);
      const value = resolved && resolved.ok && resolved.values && resolved.values[0] != null
        ? String(resolved.values[0])
        : '';
      if (value) valueSet.add(value);
      const extractor = toJmeterExtractor({ ...item, varName });
      const record = {
        ...item,
        id: `m${index}_${varName}_${vars.length}`,
        varName,
        value,
        jsonPath: extractor.jsonPath || item.jsonPath || '',
        regex: extractor.regex || '',
        type: extractor.type,
        useHeaders: Boolean(extractor.useHeaders),
        key: extractor.sourceKey || item.varName,
        kind: 'manual',
        sourceIndex: index,
        sourceMethod: list[index].method,
        sourceUrl: list[index].url,
        enabled: true,
        arrayUnpack: Boolean(item.arrayUnpack)
      };
      record.uses = value ? findUses(list, record) : [];
      vars.push(record);
    });
  });

  const pushCandidate = (index, item, varName) => {
    if (!autoCorrelate) return;
    if (vars.filter((row) => row.kind !== 'manual').length >= MAX_VARS) return;
    if (item.exportable === false) return;
    if (valueSet.has(item.value)) return;
    if (extractorsByIndex[index].length >= MAX_EXTRACTORS_PER_RECORD) return;
    if (!blobHasValue(blobs, index + 1, blobs.length, item.value)) return;
    if (!item.isToken && !item.isRefresh && blobHasValue(blobs, 0, index, item.value)) return;
    valueSet.add(item.value);
    const id = `v${index}_${varName}_${vars.length}`;
    const record = {
      ...item,
      id,
      varName,
      sourceIndex: index,
      sourceMethod: list[index] && list[index].method,
      sourceUrl: list[index] && list[index].url,
      enabled: true
    };
    record.uses = findUses(list, record);
    vars.push(record);
  };

  if (autoCorrelate) {
    list.forEach((record, index) => {
      const hits = collectHits(record);
      hits.filter((item) => item.isRefresh)
        .sort((a, b) => a.rank - b.rank || b.value.length - a.value.length)
        .forEach((item) => {
          const varName = nextRefreshName(refreshCount);
          refreshCount += 1;
          usedNames.add(varName.toLowerCase());
          pushCandidate(index, item, varName);
        });

      hits.filter((item) => item.isToken && !item.isRefresh)
        .sort((a, b) => a.rank - b.rank || b.value.length - a.value.length)
        .forEach((item) => {
          const varName = nextTokenName(tokenCount);
          tokenCount += 1;
          usedNames.add(varName.toLowerCase());
          pushCandidate(index, item, varName);
          jwtClaimHits(item.value).forEach((claim) => {
            if (!blobHasValue(blobs, index + 1, blobs.length, claim.value)) return;
            jwtNotes.push({
              ...claim,
              sourceIndex: index,
              parentVar: varName
            });
          });
        });

      if (vars.length < MAX_VARS + manualsByIndex.reduce((n, items) => n + ((items && items.length) || 0), 0)) {
        hits.filter((item) => !item.isToken && !item.isRefresh)
          .sort((a, b) => Number(Boolean(b.isCursor)) - Number(Boolean(a.isCursor)) || b.value.length - a.value.length)
          .slice(0, MAX_ID_CANDIDATES)
          .forEach((item) => {
            pushCandidate(index, item, sanitizeVarName(item.key, usedNames));
          });
      }

      const htmlCsrf = findHtmlCsrf(record.responseBody);
      if (htmlCsrf) {
        pushCandidate(index, htmlCsrf, sanitizeVarName(htmlCsrf.key, usedNames));
      }
    });
  }

  const active = applyCorrelateEdits(vars, options && options.edits);
  extractorsByIndex.forEach((arr) => { arr.length = 0; });
  active.forEach((item) => {
    if (item.kind === 'manual') {
      extractorsByIndex[item.sourceIndex].push(toJmeterExtractor({
        ...item,
        varName: item.varName,
        jsonPath: item.jsonPath,
        arrayUnpack: item.arrayUnpack
      }));
      return;
    }
    if (extractorsByIndex[item.sourceIndex].length >= MAX_EXTRACTORS_PER_RECORD) return;
    extractorsByIndex[item.sourceIndex].push({
      varName: item.varName,
      jsonPath: item.jsonPath,
      regex: item.regex,
      type: item.type || (item.regex ? 'regex' : 'json'),
      useHeaders: Boolean(item.useHeaders),
      sourceKey: item.key,
      kind: item.kind
    });
  });

  const plans = list.map((record, index) => {
    const headers = normalizeHeaders(record.requestHeaders || record.headers || {});
    let body = record.requestBody != null && record.requestBody !== ''
      ? String(record.requestBody)
      : String(record.body || '');
    let path = requestPath(record);
    const applicable = active.filter((item) => item.sourceIndex < index)
      .sort((a, b) => b.value.length - a.value.length);

    if (applicable.length) {
      for (const key of Object.keys(headers)) {
        if (SKIP_SUB_HEADER_RE.test(key)) continue;
        headers[key] = substitute(headers[key], applicable);
      }
      body = substitute(body, applicable);
      path = substitutePath(path, applicable);
    }

    let multipart = record.multipart || null;
    if (multipart && applicable.length && Array.isArray(multipart.fields)) {
      multipart = {
        ...multipart,
        fields: multipart.fields.map((field) => ({
          ...field,
          value: substitute(field.value || '', applicable)
        }))
      };
    }

    return {
      headers,
      body,
      path,
      extractors: extractorsByIndex[index],
      multipart
    };
  });

  plans.report = {
    vars: vars.map((item) => ({
      id: item.id,
      varName: (active.find((row) => row.id === item.id) || item).varName,
      value: item.value,
      sourceIndex: item.sourceIndex,
      sourceMethod: item.sourceMethod || '',
      sourceUrl: item.sourceUrl || '',
      sourceKey: item.key,
      jsonPath: item.jsonPath || '',
      regex: item.regex || '',
      type: item.type || (item.regex ? 'regex' : 'json'),
      kind: item.kind || 'id',
      useHeaders: Boolean(item.useHeaders),
      uses: item.uses || [],
      enabled: active.some((row) => row.id === item.id)
    })),
    jwtClaims: jwtNotes
  };
  return plans;
}

module.exports = {
  correlateTokens,
  findToken,
  substitute,
  substitutePath,
  parseLeaves,
  applyCorrelateEdits,
  TOKEN_KEYS,
  REFRESH_TOKEN_KEYS
};
