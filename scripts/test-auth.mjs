// 认证层回归测试。
//
// 锁定三件事：
//  1. 两种凭据的判定与请求头构造
//  2. **绝不同时发送 X-API-Key 与 Authorization**（混发会让服务端按 API-key
//     principal 走白名单，导致「明明登录成功却 401」，且极难定位）
//  3. JWT 过期判断与登录响应规整（服务端 token 字段用过 token/access_token 两种名）
//
// 运行：node scripts/test-auth.mjs

import {
  AUTH_MODE_ACCOUNT, AUTH_MODE_APIKEY,
  resolveAuthMode, buildAuthHeaders, hasCredentials,
  decodeJwtExp, isTokenExpired, normalizeLoginResponse, explainLoginError
} from '../src/utils/auth.js';

let pass = 0, fail = 0;
const fails = [];

function check(name, cond, extra) {
  if (cond) { pass++; return; }
  fail++;
  fails.push(name + (extra ? `  → ${extra}` : ''));
}
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  check(name, a === e, `实际 ${a}，期望 ${e}`);
}

// 造一个 exp 指定的 JWT（只用于测试，无需签名）
function makeJwt(expSec) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ exp: expSec, sub: 'u1' })}.sig`;
}

console.log('=== 1. 认证方式判定 ===');
eq('无配置 → apiKey 模式', resolveAuthMode(null), AUTH_MODE_APIKEY);
eq('空对象 → apiKey 模式', resolveAuthMode({}), AUTH_MODE_APIKEY);
eq('只有 apiKey（旧版本升级）→ apiKey', resolveAuthMode({ apiKey: 'sk-1' }), AUTH_MODE_APIKEY);
eq('有 token 无 authMode → 账号模式', resolveAuthMode({ authToken: 't' }), AUTH_MODE_ACCOUNT);
eq('显式 apiKey 模式优先于 token', resolveAuthMode({ authMode: 'apikey', authToken: 't', apiKey: 'k' }), AUTH_MODE_APIKEY);
eq('显式 account 模式优先于 apiKey', resolveAuthMode({ authMode: 'account', authToken: 't', apiKey: 'k' }), AUTH_MODE_ACCOUNT);
eq('未知 authMode 退回推断', resolveAuthMode({ authMode: 'bogus', apiKey: 'k' }), AUTH_MODE_APIKEY);

console.log('=== 2. 请求头构造：安全约束「绝不混发」 ===');
{
  const a = buildAuthHeaders({ authMode: 'account', authToken: 'JWT123', apiKey: 'sk-legacy' });
  eq('账号模式只发 Authorization', a.headers, { Authorization: 'Bearer JWT123' });
  check('账号模式绝不含 X-API-Key', !('X-API-Key' in a.headers));
  check('账号模式返回 mode=account', a.mode === AUTH_MODE_ACCOUNT);
}
{
  const b = buildAuthHeaders({ authMode: 'apikey', apiKey: 'sk-1', authToken: 'JWT123' });
  eq('API Key 模式只发 X-API-Key', b.headers, { 'X-API-Key': 'sk-1' });
  check('API Key 模式绝不含 Authorization', !('Authorization' in b.headers));
}
{
  const c = buildAuthHeaders({ authMode: 'account', authToken: '', apiKey: 'sk-1' });
  eq('账号模式但 token 为空 → 不发任何凭据', c.headers, {});
  check('无凭据时绝不回退到 API Key', !('X-API-Key' in c.headers),
    '账号模式下静默回退到 API Key 会让用户以为自己已登录');
}
{
  const d = buildAuthHeaders({ authMode: 'apikey', apiKey: '' });
  eq('API Key 模式但 key 为空 → 不发 header', d.headers, {});
}
eq('空 token 的 Bearer 前缀正确', buildAuthHeaders({ authMode: 'account', authToken: 'a b' }).headers.Authorization, 'Bearer a b');

console.log('=== 3. hasCredentials（路由守卫） ===');
check('账号+token → 有凭据', hasCredentials({ authMode: 'account', authToken: 't' }) === true);
check('账号无 token → 无凭据', hasCredentials({ authMode: 'account', authToken: '' }) === false);
check('apiKey 模式有 key → 有凭据', hasCredentials({ apiKey: 'k' }) === true);
check('apiKey 模式无 key → 无凭据', hasCredentials({ apiKey: '' }) === false);
check('空配置 → 无凭据', hasCredentials({}) === false);

console.log('=== 4. JWT 过期判断 ===');
{
  const now = 1_700_000_000_000; // 固定时间，避免测试随时钟漂移
  const future = makeJwt(Math.floor(now / 1000) + 3600);
  const past = makeJwt(Math.floor(now / 1000) - 10);
  eq('解析 exp（秒）', decodeJwtExp(future), Math.floor(now / 1000) + 3600);
  check('未过期 → false', isTokenExpired(future, 60, now) === false);
  check('已过期 → true', isTokenExpired(past, 60, now) === true);
  const edge = makeJwt(Math.floor(now / 1000) + 30);
  check('30 秒后过期、skew 60 → 判为过期（留出余量）', isTokenExpired(edge, 60, now) === true);
  check('非 JWT 字符串 → 不判过期（乐观假设，靠 401 兜底）', isTokenExpired('not-a-jwt', 60, now) === false);
  check('空 token → 不判过期', isTokenExpired('', 60, now) === false);
  check('无 exp 声明的 JWT → 不判过期', decodeJwtExp(makeJwt(NaN)) === null);
  check('两段畸形 token → null', decodeJwtExp('a.!!!') === null);
  // base64url（- 与 _）必须能解
  const tricky = makeJwt(Math.floor(now / 1000) - 5); // 含随机 padding 的风险
  check('base64url 变体可解码', typeof decodeJwtExp(tricky) === 'number');
}

console.log('=== 5. 登录响应规整 ===');
{
  const full = normalizeLoginResponse({
    success: true,
    token: 'T1', refresh_token: 'R1',
    user: { id: 'u1', username: 'lichong', email: 'a@b.c', tenant_id: 10000 },
    active_tenant: { id: 10000, name: 'default' }
  });
  eq('token 取到', full.token, 'T1');
  eq('refresh_token 取到', full.refreshToken, 'R1');
  eq('用户名', full.user.username, 'lichong');
  eq('租户 ID（数字→字符串）', full.tenantId, '10000');
  eq('租户名', full.tenantName, 'default');
}
{
  // 旧版本字段名：access_token + tenant（无 active_tenant）
  const legacy = normalizeLoginResponse({
    success: true, access_token: 'T2', refresh_token: 'R2',
    user: { email: 'x@y.z' }, tenant: { id: 7, name: 'old' }
  });
  eq('兼容 access_token', legacy.token, 'T2');
  eq('兼容 tenant 字段', legacy.tenantId, '7');
}
{
  const nested = normalizeLoginResponse({ success: true, data: { token: 'T3', user: { id: 'u' } } });
  eq('兼容 data 包裹', nested.token, 'T3');
}
check('无 token → 失败（不得给出空凭据）', normalizeLoginResponse({ success: true }) === null);
check('success:false → 失败', normalizeLoginResponse({ success: false, message: 'bad' }) === null);
check('空响应 → 失败', normalizeLoginResponse(null) === null);
check('user 缺失不崩溃且 tenantId 可由 user 兜底',
  normalizeLoginResponse({ success: true, token: 'T', user: { tenant_id: 5 } }).tenantId === '5');

console.log('=== 6. 登录错误文案 ===');
check('401 空 message → 友好提示', explainLoginError(401, '') === '邮箱或密码不正确');
check('401 密码类英文 → 中文', explainLoginError(401, 'password is incorrect').includes('密码'));
check('401 用户不存在 → 中文', explainLoginError(401, 'user not found').includes('不存在'));
check('404 → 提示可能版本过旧', explainLoginError(404, '').includes('API Key'));
check('0 → 网络提示', explainLoginError(0, '').includes('无法连接'));
check('其它状态保留后端原文', explainLoginError(500, '内部错误') === '内部错误');

console.log('');
console.log(`结果：${pass} 通过，${fail} 失败`);
if (fail) {
  console.log('\n失败项：');
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}