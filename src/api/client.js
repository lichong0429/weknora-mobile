import { getApiKey, getBaseUrl } from '../config.js';
import { logRequest, logResponse } from './debug.js';

// preview 读取策略：文本类读取完整内容（上限 2MB，覆盖绝大多数文档），
// 避免 6064 字节时代码把长文档截断成 ~4500 字符（曾导致"预览显示不完整、网页端正常"的反馈）
const PREVIEW_TEXT_LEN = 2 * 1024 * 1024; // 2MB

function buildUrl(path) {
  const base = getBaseUrl()
    .replace(/\/api\/v1\/?$/, '')
    .replace(/\/api\/?$/, '')
    .replace(/\/$/, '');
  const apiBase = base ? `${base}/api/v1` : '/api/v1';
  return apiBase + (path.startsWith('/') ? path : `/${path}`);
}

function getHeaders(isJson = true) {
  const headers = {
    Accept: 'application/json',
    'X-API-Key': getApiKey()
  };
  if (isJson) headers['Content-Type'] = 'application/json';
  return headers;
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

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: isJson ? JSON.stringify(body) : body,
      signal
    });
    const logBody = await res.clone().text().catch(() => '');
    logResponse({ id: reqEntry.id, status: res.status, statusText: res.statusText, body: logBody });
    return handleResponse(res);
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
  const headers = getHeaders(false);
  const reqEntry = logRequest({ method: 'GET', url: url.toString(), headers, body: params });

  try {
    const res = await fetch(url.toString(), { headers });
    const logBody = await res.clone().text().catch(() => '');
    logResponse({ id: reqEntry.id, status: res.status, statusText: res.statusText, body: logBody });
    return handleResponse(res);
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
  const headers = { ...getHeaders(false), Accept: 'text/plain,*/*' };
  const reqEntry = logRequest({ method: 'GET', url: url.toString(), headers, body: params });

  try {
    const res = await fetch(url.toString(), { headers });
    const logBody = await res.clone().text().catch(() => '');
    logResponse({ id: reqEntry.id, status: res.status, statusText: res.statusText, body: logBody });
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
    const reqEntry = logRequest({ method: 'POST', url, headers: { 'X-API-Key': '***' }, body: '[FormData]' });

    let aborted = false;
    const onAbort = () => {
      aborted = true;
      try { xhr.abort(); } catch {}
    };
    signal?.addEventListener('abort', onAbort);

    const cleanup = () => signal?.removeEventListener('abort', onAbort);

    xhr.open('POST', url, true);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('X-API-Key', getApiKey());

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
async function* sseParser(reader) {
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
    return event;
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      const ev = flush();
      if (ev) yield ev;
      break;
    }
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

export async function* chatStream(sessionId, payload, { type = 'knowledge', signal } = {}) {
  const endpoint = type === 'agent' ? `/agent-chat/${sessionId}` : `/knowledge-chat/${sessionId}`;
  const url = buildUrl(endpoint);
  const headers = getHeaders(true);
  logRequest({ method: 'POST', url, headers, body: payload });

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    logResponse({ status: res.status, statusText: res.statusText, error: msg });
    throw new Error(msg);
  }
  // 非 SSE 响应（如后端直接返回 JSON）——读取完整 body 作为错误消息
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') && !contentType.includes('application/octet-stream')) {
    const text = await res.text();
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
  for await (const ev of sseParser(res.body.getReader())) {
    try {
      yield { ...ev, json: JSON.parse(ev.data) };
    } catch {
      yield ev;
    }
  }
}
