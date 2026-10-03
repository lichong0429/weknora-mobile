import { getBaseUrl, getConfig } from '../config.js';
import { logRequest, logResponse } from './debug.js';
import { buildAuthHeaders, resolveAuthMode, AUTH_MODE_ACCOUNT } from '../utils/auth.js';
import { refreshToken } from './auth.js';

// preview 读取策略：文本类读取完整内容（上限 2MB，覆盖绝大多数文档），
// 避免 6064 字节时代码把长文档截断成 ~4500 字符（曾导致"预览显示不完整、网页端正常"的反馈）
const PREVIEW_TEXT_LEN = 2 * 1024 * 1024; // 2MB

export function buildUrl(path, overrideBase) {
  const base = (overrideBase || getBaseUrl())
    .replace(/\/api\/v1\/?$/, '')
    .replace(/\/api\/?$/, '')
    .replace(/\/$/, '');
  const apiBase = base ? `${base}/api/v1` : '/api/v1';
  return apiBase + (path.startsWith('/') ? path : `/${path}`);
}

// 鉴权头统一由 utils/auth.js 构造：账号模式发 Authorization，API Key 模式发 X-API-Key，
// **两者互斥**。混发时服务端会按 API-key principal 走白名单鉴权，
// 表现为「明明登录成功却到处 401」，且极难定位。
function getHeaders(isJson = true, extra = {}) {
  const { headers } = buildAuthHeaders(getConfig());
  const out = { ...headers, ...extra, Accept: 'application/json' };
  if (isJson) out['Content-Type'] = 'application/json';
  return out;
}

// 登录态失效时的回调（由 App 层接到「跳登录页」）
let unauthorizedHandler = null;
export function onUnauthorized(handler) {
  unauthorizedHandler = handler;
}

// 401 自动刷新：账号模式下 access token 会过期，用 refresh token 静默换新后重发一次。
// 并发请求共用同一次刷新 —— 后端会轮换 refresh token，
// 并发刷新会让先发出的那次拿到已失效的 token 而莫名失败。
let refreshInFlight = null;
async function tryRefresh() {
  if (resolveAuthMode(getConfig()) !== AUTH_MODE_ACCOUNT) return false;
  if (!refreshInFlight) {
    refreshInFlight = refreshToken().finally(() => { refreshInFlight = null; });
  }
  const ok = await refreshInFlight;
  if (!ok) {
    // 刷新失败 = 登录态确已失效，通知外层跳登录页
    try { unauthorizedHandler?.(); } catch {}
  }
  return ok === true;
}

// 遇到 401 时：尝试刷新，成功则用新凭据重发一次；返回最终响应（或 null 表示放弃）。
// 注意重发最多一次 —— 刷新后仍 401 说明凭据真的失效了，不能无限循环。
async function resendOn401(res, resend) {
  if (res.status !== 401) return res;
  const ok = await tryRefresh();
  if (!ok) return res;
  return resend();
}

// 诊断日志要能看到「用的是哪种鉴权」，但绝不能留下凭据原文
function maskAuthHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    if (k === 'X-API-Key') out[k] = v ? '***' : '';
    else if (k === 'Authorization') out[k] = v ? 'Bearer ***' : '';
    else out[k] = v;
  }
  return out;
}

async function handleResponse(res) {
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      msg = body.error?.message || body.message || msg;
    } catch {}
    throw new Error(msg);
  }
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/html')) {
    throw new Error(`后端返回了 HTML 页面，而不是 JSON。请检查设置里的 WeKnora 地址是否正确（当前请求地址可能被误配成了当前网页地址）。`);
  }
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`后端返回了非 JSON 内容：${text.slice(0, 200)}`);
  }
}

export async function request(method, path, body = null, signal = null) {
  const isJson = body && !(body instanceof FormData);
  const url = buildUrl(path);
  const headers = getHeaders(isJson);
  const reqEntry = logRequest({ method, url, headers, body: isJson ? body : '[FormData/Binary]' });

  const send = async () => {
    const res = await fetch(url, {
      method,
      headers: getHeaders(isJson),
      body: isJson ? JSON.stringify(body) : body,
      signal
    });
    logResponse({ id: reqEntry.id, status: res.status, statusText: res.statusText, body: await res.clone().text().catch(() => '') });
    return res;
  };

  try {
    // 401 → 刷新 token 后重发一次（仅账号模式），拿到最终响应再解析
    const finalRes = await resendOn401(await send(), send);
    return await handleResponse(finalRes);
  } catch (err) {
    logResponse({ id: reqEntry.id, status: 0, statusText: err.name, error: err.message || String(err) });
    throw err;
  }
}

export async function get(path, params = {}) {
  const url = new URL(buildUrl(path), window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const reqEntry = logRequest({ method: 'GET', url: url.toString(), headers: getHeaders(false), body: params });

  const send = async () => {
    const res = await fetch(url.toString(), { headers: getHeaders(false) });
    logResponse({ id: reqEntry.id, status: res.status, statusText: res.statusText, body: await res.clone().text().catch(() => '') });
    return res;
  };

  try {
    return await handleResponse(await resendOn401(await send(), send));
  } catch (err) {
    logResponse({ id: reqEntry.id, status: 0, statusText: err.name, error: err.message || String(err) });
    throw err;
  }
}

export async function getText(path, params = {}) {
  const url = new URL(buildUrl(path), window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const reqEntry = logRequest({ method: 'GET', url: url.toString(), headers: getHeaders(false), body: params });

  const send = async () => {
    const res = await fetch(url.toString(), { headers: { ...getHeaders(false), Accept: 'text/plain,*/*' } });
    logResponse({ id: reqEntry.id, status: res.status, statusText: res.statusText, body: await res.clone().text().catch(() => '') });
    return res;
  };

  try {
    const res = await resendOn401(await send(), send);
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const body = await res.json(); msg = body.error?.message || body.message || msg; } catch {}
      throw new Error(msg);
    }
    return await res.text();
  } catch (err) {
    logResponse({ id: reqEntry.id, status: 0, statusText: err.name, error: err.message || String(err) });
    throw err;
  }
}

// 获取文件 blob（用于图片等二进制资源）
export async function getBlob(path, params = {}) {
  const url = new URL(buildUrl(path), window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const headers = { ...getHeaders(false), Accept: '*/*' };

  try {
    const res = await fetch(url.toString(), { headers });
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try { const body = await res.json(); msg = body.error?.message || body.message || msg; } catch {}
      throw new Error(msg);
    }
    return await res.blob();
  } catch (err) {
    throw err;
  }
}

// 获取文件 blob 同时返回 Content-Type，用于 preview 这类需要看 mime 决定怎么渲染的场景
export async function getBlobWithType(path, params = {}) {
  const url = new URL(buildUrl(path), window.location.origin);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const headers = { ...getHeaders(false), Accept: '*/*' };

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body = await res.json(); msg = body.error?.message || body.message || msg; } catch {}
    throw new Error(msg);
  }
  const contentType = res.headers.get('content-type') || '';
  const blob = await res.blob();
  return { blob, contentType, size: blob.size };
}

// 流式拉取 preview：文本类读取完整内容（上限 2MB），图片/二进制读完整 blob。
// 返回 { contentType, isBinary, isImage, text?, blob?, size }
export async function fetchPreview(path, maxTextLen = PREVIEW_TEXT_LEN) {
  const url = new URL(buildUrl(path), window.location.origin);
  const headers = { ...getHeaders(false), Accept: '*/*' };

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const body = await res.json(); msg = body.error?.message || body.message || msg; } catch {}
    throw new Error(msg);
  }
  const contentType = res.headers.get('content-type') || '';
  const mime = contentType.toLowerCase();
  const isImage = mime.startsWith('image/');
  const isBinary = isImage
    || mime.startsWith('application/pdf')
    || mime.startsWith('audio/')
    || mime.startsWith('video/')
    || mime.includes('officedocument')
    || mime.includes('msword')
    || mime.includes('excel')
    || mime.includes('powerpoint')
    || mime.includes('zip')
    || mime.includes('epub');

  if (!isBinary) {
    // 文本类：流式读取，达到上限即取消后续下载
    const reader = res.body?.getReader ? res.body.getReader() : null;
    if (!reader) {
      // 不支持流式时退回整份读取
      const text = await res.text();
      return { contentType, isBinary: false, isImage: false, text, size: text.length };
    }
    const decoder = new TextDecoder();
    const chunks = [];
    let received = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        if (received >= maxTextLen) break;
      }
    } finally {
      // 已拿到足够内容，放弃剩余字节（关闭流）
      try { await reader.cancel(); } catch {}
    }
    const text = decoder.decode(concatBytes(chunks)).slice(0, maxTextLen);
    return { contentType, isBinary: false, isImage: false, text, size: received };
  }

  // 图片/二进制：读取完整 blob 用于内联渲染或下载
  const blob = await res.blob();
  return { contentType, isBinary: true, isImage, blob, size: blob.size };
}

function concatBytes(chunks) {
  if (chunks.length === 1) return chunks[0];
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

export async function post(path, body = {}, signal = null) {
  return request('POST', path, body, signal);
}

// 暴露解析后的绝对地址：原生下载桥（Android）无法读 localStorage，
// 因此由前端把完整 URL 和 API Key 传过去，原生只负责发起请求与落盘。
export function buildApiUrl(path) {
  return buildUrl(path);
}

// 从 Content-Disposition 解析文件名（同时支持 filename*=UTF-8'' 与普通 filename=）
export function parseContentDispositionName(header) {
  if (!header) return '';
  const star = /filename\*=(?:UTF-8|utf-8)''([^;]+)/i.exec(header);
  if (star?.[1]) {
    try { return decodeURIComponent(star[1].replace(/^"|"$/g, '')); } catch { return star[1]; }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1] ? plain[1].trim() : '';
}

// 浏览器环境（PWA / 桌面网页）下载：fetch → blob → a[download]。
// Android WebView 里这条路径走不通（WebView 不实现 blob 下载、a[download] 被忽略），
// 所以原生壳内一律走 utils/nativeDownload.js 的桥；这里只作为非原生环境的回退。
export async function downloadAsBlob(path, { method = 'GET', body = null, fileName = 'download' } = {}) {
  const url = buildUrl(path);
  const isJson = body && !(body instanceof FormData);
  const res = await fetch(url, {
    method,
    headers: { ...getHeaders(isJson), Accept: '*/*' },
    body: isJson ? JSON.stringify(body) : body
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      msg = j.error?.message || j.message || msg;
    } catch {}
    throw new Error(msg);
  }
  const blob = await res.blob();
  const name = parseContentDispositionName(res.headers.get('content-disposition')) || fileName;
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objUrl), 60000);
  return { fileName: name, size: blob.size };
}

export async function put(path, body = {}) {
  return request('PUT', path, body);
}

export async function del(path, body = null) {
  return request('DELETE', path, body);
}

export async function uploadFile(kbId, file, extra = {}) {
  const form = new FormData();
  form.append('file', file);
  if (extra.fileName) form.append('fileName', extra.fileName);
  if (extra.tagId) form.append('tag_id', extra.tagId);
  if (extra.channel) form.append('channel', extra.channel);
  return request('POST', `/knowledge-bases/${kbId}/knowledge/file`, form);
}

// 带真实上传进度的文件上传。
// fetch 无法获知请求体上传进度（只有响应流），因此这里用 XHR：
//   - onProgress(loaded, total) 供上传队列展示真实百分比
//   - signal(AbortSignal) 支持「取消上传」
// 返回后端创建的 knowledge 对象（含 id / parse_status），调用方据此接管解析状态轮询。
export function uploadFileWithProgress(kbId, file, { fileName, tagId, channel, onProgress, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (fileName) form.append('fileName', fileName);
    if (tagId) form.append('tag_id', tagId);
    if (channel) form.append('channel', channel);

    const url = buildUrl(`/knowledge-bases/${kbId}/knowledge/file`);
    const xhr = new XMLHttpRequest();
    // 鉴权头与其它请求走同一套构造（账号模式 → Authorization）
    const authHeaders = getHeaders(false);
    const reqEntry = logRequest({ method: 'POST', url, headers: maskAuthHeaders(authHeaders), body: '[FormData]' });

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try { xhr.abort(); } catch {}
    };
    signal?.addEventListener('abort', onAbort);

    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', url, true);
    Object.entries(authHeaders).forEach(([k, v]) => {
      try { xhr.setRequestHeader(k, v); } catch {}
    });

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
    };

    xhr.onload = () => {
      cleanup();
      const contentType = xhr.getResponseHeader('content-type') || '';
      const text = xhr.responseText || '';
      logResponse({ id: reqEntry.id, status: xhr.status, statusText: xhr.statusText, body: text.slice(0, 2000) });

      if (xhr.status >= 200 && xhr.status < 300) {
        if (contentType.includes('text/html')) {
          reject(new Error('后端返回了 HTML 页面，而不是 JSON。请检查设置里的 WeKnora 地址。'));
          return;
        }
        if (!text) { resolve(null); return; }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`后端返回了非 JSON 内容：${text.slice(0, 200)}`));
        }
        return;
      }

      let msg = `HTTP ${xhr.status}`;
      try {
        const body = JSON.parse(text);
        msg = body.error?.message || body.message || msg;
      } catch {}
      reject(new Error(msg));
    };

    xhr.onerror = () => {
      cleanup();
      logResponse({ id: reqEntry.id, status: 0, statusText: 'error', error: 'network error' });
      reject(new Error('网络错误：无法连接后端，请检查地址与网络。'));
    };

    xhr.ontimeout = () => {
      cleanup();
      reject(new Error('上传超时，请重试。'));
    };

    xhr.onabort = () => {
      cleanup();
      logResponse({ id: reqEntry.id, status: 0, statusText: 'aborted' });
      reject(aborted ? new DOMException('Aborted', 'AbortError') : new Error('上传已取消'));
    };

    xhr.send(form);
  });
}

// SSE streaming for chat endpoints
//
// stats 用于诊断：把「到底收到了什么」变成可判定的事实。
// 历史上「未收到回答」只能给出三条猜测（模型没配/知识库没内容/网络异常），
// 无法区分是流没开、开了但零帧、帧到了但解析失败、还是后端显式报错。
async function* sseParser(reader, stats) {
  const decoder = new TextDecoder();
  let buffer = '';
  let current = { event: 'message', dataLines: [] };

  const flush = () => {
    if (current.dataLines.length === 0) return null;
    const event = {
      event: current.event,
      data: current.dataLines.join('\n')
    };
    current = { event: 'message', dataLines: [] };
    if (stats) stats.frames += 1;
    return event;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      const ev = flush();
      if (ev) yield ev;
      break;
    }
    if (stats && value) stats.bytes += value.length;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      if (line.startsWith('event:')) {
        current.event = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        current.dataLines.push(line.slice(5).trim());
      } else if (line.trim() === '') {
        const ev = flush();
        if (ev) yield ev;
      }
    }
  }
}

/**
 * 知识问答 / 智能体问答的 SSE 流。
 *
 * @param {object} [opts]
 * @param {string} [opts.type]   'knowledge' | 'agent'
 * @param {AbortSignal} [opts.signal]
 * @param {(diag: object) => void} [opts.onMeta]
 *   诊断回调，每次状态变化时调用，字段：
 *   status / contentType / requestId / frames(收到帧数) / bytes / parseErrors / sampleRaw
 *   用于把「没有回答」定位到具体环节，而不是给用户三句猜测。
 */
export async function* chatStream(sessionId, payload, { type = 'knowledge', signal, onMeta } = {}) {
  const endpoint = type === 'agent' ? `/agent-chat/${sessionId}` : `/knowledge-chat/${sessionId}`;
  const url = buildUrl(endpoint);
  const stats = { frames: 0, bytes: 0, parseErrors: 0, sampleRaw: '' };
  const diag = {
    endpoint,
    url,
    status: 0,
    contentType: '',
    requestId: '',
    frames: 0,
    bytes: 0,
    parseErrors: 0,
    sampleRaw: ''
  };
  const report = (patch) => {
    Object.assign(diag, patch, { frames: stats.frames, bytes: stats.bytes });
    try { onMeta?.({ ...diag }); } catch {}
  };

  // Accept 用 text/event-stream：这是 SSE 的正确内容协商，经反向代理时更不易被改写
  logRequest({ method: 'POST', url, headers: getHeaders(true), body: payload });

  // 头必须在**每次实际发起请求时**读取：账号模式下 token 可能刚被刷新过，
  // 提前算好会把旧 token 发出去（流式请求是重灾区 —— 打开对话时 token 常已过期）
  const openStream = () => fetch(url, {
    method: 'POST',
    headers: { ...getHeaders(true), Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal
  });

  // 尚未流出任何内容时可以安全重发一次（流一旦开始就不能重放）
  const res = await resendOn401(await openStream(), openStream);
  report({
    status: res.status,
    contentType: res.headers.get('content-type') || '',
    requestId: res.headers.get('x-request-id') || res.headers.get('x-requestid') || ''
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    let raw = '';
    try {
      raw = await res.text();
      msg = JSON.parse(raw).error?.message || msg;
    } catch {}
    stats.sampleRaw = (raw || '').slice(0, 300);
    report({ sampleRaw: stats.sampleRaw });
    logResponse({ status: res.status, statusText: res.statusText, error: msg });
    throw new Error(msg);
  }
  // 非 SSE 响应（如后端直接返回 JSON）——读取完整 body 作为错误消息
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') && !contentType.includes('application/octet-stream')) {
    const text = await res.text();
    stats.sampleRaw = text.slice(0, 300);
    report({ sampleRaw: stats.sampleRaw });
    logResponse({ status: res.status, statusText: res.statusText, body: text });
    // 尝试解析为 JSON 错误
    try {
      const json = JSON.parse(text);
      if (json.error?.message) throw new Error(json.error.message);
      if (json.message) throw new Error(json.message);
    } catch (e) {
      if (e.message && !e.message.startsWith('Unexpected')) throw e;
    }
    // 如果不是错误 JSON，尝试把内容当作单次回答返回
    if (text.trim()) {
      yield { event: 'message', json: { response_type: 'answer', content: text, done: true } };
      return;
    }
    throw new Error('服务器返回了空响应（非 SSE 流）。请检查后端是否配置了大语言模型。');
  }
  if (!res.body) {
    throw new Error('服务器响应不支持流式读取（ReadableStream 不可用）。');
  }
  logResponse({ status: res.status, statusText: 'SSE stream started', body: '[event-stream]' });
  for await (const ev of sseParser(res.body.getReader(), stats)) {
    try {
      yield { ...ev, json: JSON.parse(ev.data) };
    } catch {
      // 解析失败的帧以前是静默丢弃的：若后端发出非 JSON 载荷（如纯文本错误、
      // HTML 片段），客户端会"一帧不认"却只显示「未收到回答」。这里留证据。
      stats.parseErrors += 1;
      if (!stats.sampleRaw) stats.sampleRaw = String(ev.data || '').slice(0, 300);
      report({ parseErrors: stats.parseErrors, sampleRaw: stats.sampleRaw });
      yield ev;
    }
  }
  report({});
}

