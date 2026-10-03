// 账号密码认证（JWT）。
//
// 与 API Key 模式**并存**：本模块只负责账号这条路，
// 切换方式由 config.authMode 决定（见 utils/auth.js）。
//
// 服务端契约（对齐 WeKnora client/auth.go）：
//   POST /auth/login    { email, password } → { token, refresh_token, user, active_tenant }
//   POST /auth/refresh  { refreshToken }     → { access_token, refresh_token }
//   GET  /auth/me                            → 当前用户与能力
//
// 注意：登录/刷新请求本身**不能带凭据头**，否则会与服务端的鉴权中间件打架
// （登录接口被标记为公开路由，但带上过期 token 反而可能触发 401）。

import { buildUrl } from './client.js';
import { getConfig, setConfig } from '../config.js';
import { normalizeLoginResponse, explainLoginError } from '../utils/auth.js';

async function postJson(path, body, { baseUrl } = {}) {
  const url = buildUrl(path, baseUrl);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const raw = (json && (json.error?.message || json.message)) || '';
    const err = new Error(explainLoginError(res.status, raw));
    err.status = res.status;
    throw err;
  }
  if (json === null) {
    throw new Error(`服务器返回了非 JSON 内容：${text.slice(0, 120)}`);
  }
  return json;
}

/**
 * 用邮箱 + 密码登录，成功后把凭据写入本地配置。
 * @returns {Promise<{user: object|null, tenantId: string, tenantName: string}>}
 */
export async function login({ email, password, baseUrl }) {
  const cleanEmail = String(email || '').trim();
  if (!cleanEmail) throw new Error('请填写邮箱/账号');
  if (!password) throw new Error('请填写密码');

  // 用当前保存的地址，避免用户在登录页改了地址还没落到配置里
  const target = (baseUrl || getConfig().baseUrl || '').trim();
  const body = await postJson('/auth/login', { email: cleanEmail, password }, { baseUrl: target });

  const norm = normalizeLoginResponse(body);
  if (!norm) {
    // 200 但没拿到 token：常见于服务端版本不支持或返回体形状变化
    throw new Error('登录成功但未获得访问令牌，请确认该 WeKnora 版本支持账号登录（/auth/login），或改用 API Key 登录。');
  }

  setConfig({
    authMode: 'account',
    authToken: norm.token,
    authRefreshToken: norm.refreshToken,
    authUser: norm.user,
    authTenantId: norm.tenantId,
    authTenantName: norm.tenantName,
    authEmail: cleanEmail,
    // 记住邮箱，回退到 API Key 方式或需要重新登录时不用再手打
    ...(target ? { baseUrl: target } : {})
  });

  return { user: norm.user, tenantId: norm.tenantId, tenantName: norm.tenantName };
}

/**
 * 用 refresh token 换新的 access token。
 * 成功返回 true 并写回配置；不可刷新返回 false（**不抛异常**，
 * 让调用方走「跳登录页」而不是抛错打断界面）。
 */
export async function refreshToken() {
  const cfg = getConfig();
  const refresh = cfg.authRefreshToken;
  if (!refresh) return false;
  try {
    const body = await postJson('/auth/refresh', { refreshToken: refresh });
    const token = body?.access_token || body?.data?.access_token || '';
    if (!token) return false;
    setConfig({
      authToken: token,
      authRefreshToken: body.refresh_token || body?.data?.refresh_token || refresh
    });
    return true;
  } catch {
    return false;
  }
}

/** 拉取当前登录用户（用于校验凭据是否仍有效）。不可用时返回 null。 */
export async function fetchMe() {
  const cfg = getConfig();
  if (!cfg.authToken) return null;
  const url = buildUrl('/auth/me');
  const res = await fetch(url, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${cfg.authToken}` }
  });
  if (!res.ok) return null;
  try {
    const body = JSON.parse(await res.text());
    const d = body?.data || {};
    const user = d.user || body?.user || null;
    if (!user) return null;
    const tenant = d.tenant || body?.tenant || null;
    setConfig({
      authUser: {
        id: user.id || '',
        username: user.username || '',
        email: user.email || '',
        tenantId: user.tenant_id != null ? String(user.tenant_id) : (cfg.authTenantId || '')
      },
      authTenantId: tenant?.id != null ? String(tenant.id) : (cfg.authTenantId || ''),
      authTenantName: tenant?.name || cfg.authTenantName || ''
    });
    return { user, tenant };
  } catch {
    return null;
  }
}

/**
 * 退出登录：清掉账号凭据并切回 API Key 模式。
 * 不动 baseUrl —— 换服务地址时用户填的地址要保留。
 */
export function logout() {
  const cfg = getConfig();
  setConfig({
    authMode: cfg.apiKey ? 'apikey' : 'account',
    authToken: '',
    authRefreshToken: '',
    authUser: null,
    authTenantId: '',
    authTenantName: ''
  });
}

/** 切换到 API Key 方式（保留已存的 key，便于来回切）。 */
export function switchToApiKeyMode(apiKey) {
  setConfig({ authMode: 'apikey', ...(apiKey ? { apiKey } : {}) });
}