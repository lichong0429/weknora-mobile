const MAX_LOGS = 50;
let logs = [];

function safeString(v) {
  try {
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  } catch {
    return '[object]';
  }
}

export function logRequest({ method, url, headers, body }) {
  const safeHeaders = { ...headers };
  // 两种凭据都要脱敏：账号模式的 Authorization 里是完整 JWT，
  // 落到诊断日志等于把可复用凭据留在设备上（曾只脱敏 X-API-Key）
  if (safeHeaders['X-API-Key']) safeHeaders['X-API-Key'] = '***';
  if (safeHeaders['Authorization']) safeHeaders['Authorization'] = 'Bearer ***';
  const entry = {
    id: Date.now() + Math.random(),
    type: 'request',
    time: new Date().toISOString(),
    method,
    url,
    headers: safeHeaders,
    body: safeString(body)
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  return entry;
}

export function logResponse({ id, status, statusText, body, error }) {
  const entry = {
    id: Date.now() + Math.random(),
    type: 'response',
    time: new Date().toISOString(),
    ref: id,
    status,
    statusText,
    body: safeString(body),
    error
  };
  logs.push(entry);
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
  return entry;
}

export function getLogs() {
  return [...logs];
}

export function clearLogs() {
  logs = [];
}
