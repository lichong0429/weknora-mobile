/**
 * 「服务器身份」归一化 —— 判定本机保存的密码到底属于哪台服务器。
 *
 * 为什么必须有这个模块：密文里存 `baseUrl` 的唯一目的就是保护
 * 「服务器 + 账号」这个绑定关系。凭据是绑在 (服务器, 账号) 上的，不是全局的：
 *   - 若把保存的地址无条件回填 → 用户重开 App 会被静默指回上一次那台服务器；
 *   - 若完全不比较就回填密码 → 会出现「地址是 B、密码是 A 的」，
 *     用户一点登录，**A 站的密码就被明文 POST 到 B 站**（凭据泄漏）。
 * 所以只要「回填密码」这条路上有判定，判定本身就属于安全代码，必须可测、可回归。
 *
 * 为什么单独成文件（纯 JS、不含 JSX/React）：
 *   1. Node 能直接 `import` —— 断言的是**模块本体**，而不是一份拷贝；
 *   2. `Login.jsx` 只导出组件，`@vitejs/plugin-react` 的 Fast Refresh 才不会
 *      因为「文件里还有非组件导出」退化成整页刷新。
 *
 * 归一化规则（两条都是踩过的坑，别"简化"回去）：
 *   - **绝不能直接 `new URL('localhost:8080')`**：它不抛异常，而是把 `localhost`
 *     当协议、`8080` 当路径，`origin` 变成字符串 `'null'`。于是
 *     `localhost:8080` 与 `example.com:8080` 会得到同一个值 `'null8080'`，
 *     被判定成同一台服务器 —— 这正是密码投错服务器的入口。
 *     无协议时必须先补 `http://` 再解析。
 *   - **不能只比 origin**：`buildUrl()`（api/client.js）只剥 `/api` 与 `/api/v1`，
 *     其余路径前缀是保留的，说明「子路径反代部署」受支持。
 *     `http://host/weknora` 与 `http://host/other` 是两套实例，必须判为不同。
 */

/**
 * 解析成 http(s) URL。
 *
 * @param {string} raw 已 trim 的原始地址
 * @returns {URL|null} 解析成功返回 URL；协议非 http(s) 或完全无法解析返回 null
 */
function parseHttpUrl(raw) {
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
  // 无协议：先补 http:// 试一次（覆盖 `localhost:8080` / `host.example.com:8080`），
  // 再拿原串试一次（覆盖少数解析器能自行接受的写法）。
  const candidates = hasScheme ? [raw] : [`http://${raw.replace(/^\/+/, '')}`, raw];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      // 只认 http/https：`ftp://x`、`javascript:` 之类一律当无法识别
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed;
    } catch {
      // 试下一个候选
    }
  }
  return null;
}

/**
 * 归一化路径：剥掉 API 后缀、去掉尾部斜杠。
 *
 * 与 `api/client.js` 的 `buildUrl` 保持同一套「剥 API 后缀」规则 ——
 * 用户把地址填成 `http://host/api/v1` 与 `http://host` 时，两边的请求打到的是
 * 同一台服务器的同一个接口，不应被判成两台（否则密码永远不回填）。
 * 路径**不做小写**：HTTP 路径区分大小写，服务端可能靠大小写区分资源。
 *
 * @param {string} pathname URL 的 pathname
 * @returns {string} 归一化路径（根路径返回 ''）
 */
function normalizePath(pathname) {
  const stripped = String(pathname || '')
    .replace(/\/api\/v1\/?$/i, '')
    .replace(/\/api\/?$/i, '')
    .replace(/\/+$/, '');
  return stripped === '/' ? '' : stripped;
}

/** 退化分支用：只做「去尾斜杠 + 去 API 后缀」，保留大小写 |
 *  @param {string} s 原始串
 *  @returns {string} */
function stripApiSuffix(s) {
  return String(s).replace(/\/+$/, '').replace(/\/api(\/v1)?$/i, '');
}

/**
 * 归一化服务器地址，用于判断「保存的密码是不是当前这台服务器的」。
 *
 * @param {unknown} input 原始地址（任意类型，非字符串一律当空）
 * @returns {string} 归一化身份：`origin`（含协议、小写主机、默认端口已吃）+ 归一化路径；
 *   无法识别时返回退化串；空值 / 无法得到有意义结果时返回 `''`。
 *   **任何情况下都不会返回 `'null'` 或 `'undefined'`。**
 */
export function normalizeBaseUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  const parsed = parseHttpUrl(raw);
  if (!parsed) {
    const fallback = stripApiSuffix(raw).toLowerCase();
    // 退化串本身可能是 'null'/'undefined' 这类坑值，统一按「无法识别」处理
    if (!fallback || fallback === 'null' || fallback === 'undefined') return '';
    return fallback;
  }
  const origin = parsed.origin.toLowerCase();
  if (!origin || origin === 'null') return '';
  return origin + normalizePath(parsed.pathname);
}

/**
 * 取给用户看的服务器标识（提示语里「这份密码属于哪台」）。
 *
 * 只给 `host:port`，不带路径 —— 目的是让用户认出服务器，不是给机器比较用。
 * 解析失败时退回原串（去尾斜杠并截断），保证提示语永远有东西可显示。
 *
 * @param {unknown} input 原始地址
 * @returns {string} host:port，或退化后的原串；空值返回 ''
 */
const FALLBACK_HOST_MAX_LEN = 48;

export function hostOfBaseUrl(input) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return '';
  const parsed = parseHttpUrl(raw);
  if (parsed && parsed.host) return parsed.host;
  const fallback = stripApiSuffix(raw);
  return fallback.length > FALLBACK_HOST_MAX_LEN
    ? `${fallback.slice(0, FALLBACK_HOST_MAX_LEN)}…`
    : fallback;
}

/**
 * 挂载回填的决策。
 *
 * 安全边界（改这里之前先读）：
 *   - 邮箱**始终**回填 —— 跨站无风险，它只是账号名；
 *   - 密码**只在 saved 与 current 都非空且归一化后相等时**回填；
 *   - **返回值里不含任何地址字段**（没有 baseUrl / url），
 *     这样调用方在类型层面就不可能"顺手"把服务器地址也写回去。
 *
 * 入参容错：`planRestore()` / `planRestore(null)` / `planRestore({})` 都必须返回
 * 「不回填密码」的结果而不是抛错 —— 这条位于登录页挂载路径上，抛一次就是白屏。
 *
 * @param {{ savedBaseUrl?: unknown, currentBaseUrl?: unknown }|null} [input]
 * @returns {{ fillEmail: boolean, fillPassword: boolean, sameServer: boolean, host: string }}
 *   `host` 为保存时那台服务器的展示标识（用于「与当前服务器不同」的提示）。
 */
export function planRestore(input = {}) {
  const { savedBaseUrl, currentBaseUrl } = input || {};
  const saved = normalizeBaseUrl(savedBaseUrl);
  const current = normalizeBaseUrl(currentBaseUrl);
  const sameServer = Boolean(saved) && Boolean(current) && saved === current;
  return {
    fillEmail: true,
    fillPassword: sameServer,
    sameServer,
    host: hostOfBaseUrl(savedBaseUrl)
  };
}
