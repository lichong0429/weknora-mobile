import { getApiKey, getBaseUrl } from '../config.js';
import { logRequest, logResponse } from './debug.js';

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

export async function post(path, body = {}, signal = null) {
  return request('POST', path, body, signal);
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
  if (!res.ok || !res.body) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error?.message || msg; } catch {}
    logResponse({ status: res.status, statusText: res.statusText, error: msg });
    throw new Error(msg);
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
