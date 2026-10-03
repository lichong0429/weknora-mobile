// 认证方式解析与鉴权头构造。
//
// WeKnora 服务端同时支持两套凭据，两套**并行有效、互不影响**：
//   1. API Key —— 请求头 `X-API-Key: <key>`（长有效，与账号无关）
//   2. 账号密码 —— `POST /auth/login` 换 JWT，之后用 `Authorization: Bearer <token>`
//
// 这里只放纯逻辑（无网络、无 React），便于单测锁定行为。
// 关键取舍：账号模式下**不再发送 X-API-Key**。
// 因为服务端把 API Key 视为独立的授权主体（API-key principal），
// 两者同时存在时行为依赖服务端路由策略（rbac 的 apiKeyGroup 白名单），
// 混发会出现「明明登录成功却 401」这类难以定位的问题。

export const AUTH_MODE_ACCOUNT = 'account';
export const AUTH_MODE_APIKEY = 'apikey';

/** 从完整配置对象判定当前生效的认证方式。 */
export function resolveAuthMode(cfg) {
  if (!cfg) return AUTH_MODE_APIKEY;
  const mode = cfg.authMode;
  if (mode === AUTH_MODE_ACCOUNT) return AUTH_MODE_ACCOUNT;
  if (mode === AUTH_MODE_APIKEY) return AUTH_MODE_APIKEY;
  // 未显式指定时的兼容推断：有 token 走账号模式，否则走 API Key 模式。
  // 这样老版本升级上来（只有 apiKey 字段）行为不变。
  if (cfg.authToken) return AUTH_MODE_ACCOUNT;
  return AUTH_MODE_APIKEY;
}

/**
 * 构造鉴权请求头。
 * @returns {{mode: string, headers: object}} mode 供调用方判断是否需要处理 401 刷新
 */
export function buildAuthHeaders(cfg) {
  const mode = resolveAuthMode(cfg);
  if (mode === AUTH_MODE_ACCOUNT) {
    const token = (cfg && cfg.authToken) || '';
    return { mode, headers: token ? { Authorization: `Bearer ${token}` } : {} };
  }
  const key = (cfg && cfg.apiKey) || '';
  return { mode, headers: key ? { 'X-API-Key': key } : {} };
}

/** 当前凭据是否足以发起请求（用于路由守卫，避免未登录时到处报错）。 */
export function hasCredentials(cfg) {
  const mode = resolveAuthMode(cfg);
  if (mode === AUTH_MODE_ACCOUNT) return Boolean(cfg && cfg.authToken);
  return Boolean(cfg && cfg.apiKey);
}

/**
 * 鉴权指纹：放进 useAsync/useEffect 的依赖数组。
 *
 * 原来依赖写的是 `config.apiKey`，账号模式下换的是 authToken，
 * 登录/退出/自动刷新都不会让依赖变化 → 页面不会重新取数，
 * 表现为「登录成功了但首页还是加载失败」。
 * 用 token 末 8 位做指纹即可，无需暴露完整凭据。
 */
export function authFingerprint(cfg) {
  const mode = resolveAuthMode(cfg);
  if (mode === AUTH_MODE_ACCOUNT) {
    const t = (cfg && cfg.authToken) || '';
    return t ? `acc:${t.slice(-8)}` : 'acc:none';
  }
  const k = (cfg && cfg.apiKey) || '';
  return k ? `key:${k.slice(-8)}` : 'key:none';
}

/** 基线 JWT 解码：取 payload 里的 exp（秒）。失败返回 null（不抛）。 */
export function decodeJwtExp(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    // base64url → base64：补回 padding 并替换 URL 安全字符
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(decodeURIComponent(escape(json)));
    // 按字段是否存在判断，而不是 Number() 强转：
    // `exp: null` 会被 Number(null) 变成 0，误判成「1970 年已过期」而拒掉可用 token。
    if (payload == null || typeof payload !== 'object') return null;
    const rawExp = payload.exp;
    if (typeof rawExp !== 'number' || !Number.isFinite(rawExp)) return null;
    return rawExp;
  } catch {
    return null;
  }
}

/**
 * token 是否已过期或即将过期。
 * 无法解析 exp 时返回 false（乐观假设有效，靠 401 兜底）——
 * 猜错方向是安全的：宁可多发一次请求被 401 拒绝，也不要把还能用的 token 误判为失效。
 */
export function isTokenExpired(token, skewSeconds = 60, nowMs = Date.now()) {
  const exp = decodeJwtExp(token);
  if (exp == null) return false;
  return exp * 1000 - skewSeconds * 1000 <= nowMs;
}

/**
 * 规整 `/auth/login` 的响应。
 * 服务端在不同版本里 token 字段用过 `token` / `access_token` 两个名字，
 * 兼容处理；都拿不到才算失败。
 */
export function normalizeLoginResponse(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.success === false) return null;
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  const token = data.token || data.access_token || '';
  if (!token) return null;
  const user = data.user || null;
  const tenant = data.active_tenant || data.tenant || null;
  return {
    token,
    refreshToken: data.refresh_token || '',
    user: user
      ? {
          id: user.id || '',
          username: user.username || '',
          email: user.email || '',
          tenantId: user.tenant_id != null ? String(user.tenant_id) : '',
        }
      : null,
    // 租户 ID 很关键：正文里的图片引用形如 local://<tenant>/exports/…，
    // 登录到别的租户时图片会取不到，这里显式带出来供界面提示。
    tenantId: tenant && tenant.id != null ? String(tenant.id) : (user && user.tenant_id != null ? String(user.tenant_id) : ''),
    tenantName: (tenant && tenant.name) || ''
  };
}

/**
 * 登录错误 → 人话。
 * 后端 401 的 message 未必友好（英文或空），这里按需覆盖常见成因。
 */
export function explainLoginError(status, rawMessage) {
  const msg = String(rawMessage || '').trim();
  if (status === 401 || status === 403) {
    if (/password/i.test(msg) && !/user|email|account|exist/i.test(msg)) {
      return '密码不正确';
    }
    if (/not\s*found|no\s*user|user.*not\s*exist/i.test(msg)) {
      return '该邮箱/账号不存在';
    }
    return msg || '邮箱或密码不正确';
  }
  if (status === 404) return msg || '该 WeKnora 服务没有提供 /auth/login（可能版本过旧，请改用 API Key 登录）';
  if (status === 429) return msg || '尝试次数过多，请稍后再试';
  if (status === 0) return '无法连接服务器，请检查地址与网络';
  return msg || `HTTP ${status}`;
}