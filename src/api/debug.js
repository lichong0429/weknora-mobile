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
  if (safeHeaders['X-API-Key']) safeHeaders['X-API-Key'] = '***';
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
