/**
 * 「保存登录密码」的原生安全存储通道（Android Keystore + AES-GCM）。
 *
 * 为什么不能用 localStorage / IndexedDB：
 * WebView 的 localStorage 是**明文文件**（Local Storage 的 leveldb 就在应用私有目录里，
 * 一次 adb backup / 云备份 / root 就能整包读走），而且普通浏览器里任何人打开
 * DevTools 都能看到。所以密码只走原生 Keystore：密钥不可导出，密文被拿到也解不开。
 *
 * 桥约定（见 MainActivity.Bridge）：
 *   三个方法都是**同步返回 JSON 字符串**，永远不抛 Java 异常给 JS：
 *     成功  {"ok":true,"data":{"email":"…","password":"…","baseUrl":"…"}}
 *     失败  {"ok":false,"code":"EMPTY|BAD_INPUT|DECRYPT_FAILED|UNAVAILABLE","message":"可读说明"}
 *   这里把它们包成 Promise，并做 JSON 解析容错（桥可能返回空串 / 平台异常文本）。
 *
 * 降级策略（普通浏览器 `npm run dev`、iOS PWA）：
 *   isAvailable() 返回 false，save/load/clear 统一返回 { ok:false, code:'UNAVAILABLE' }，
 *   **绝不抛异常、绝不回落到 localStorage 存密码** —— 宁可用户每次手输，
 *   也不能把密码明文落在可被 DevTools / 备份读走的地方。
 *
 * 安全边界（如实说明，不夸大）：
 *   能防：SharedPreferences 被 adb pull / 备份 / 同机其他应用读取；离线拿到密文也解不出
 *        明文（密钥不可导出，多数设备由 TEE / StrongBox 硬件保护，卸载重装即失效）。
 *   不能防：root 设备、Frida / Xposed 注入进程、debug 包被 jdwp 附加、
 *        输入法 / 无障碍 / 录屏抓取输入内容、用户主动点「显示密码」后被旁观。
 *        这些都属于终端已被攻破的场景，本地存储层面挡不住。
 */

/** 与原生约定的错误码（终态，UI 据此决定文案） */
export const CODE_EMPTY = 'EMPTY'; // 没保存过（不是错误）
export const CODE_BAD_INPUT = 'BAD_INPUT'; // 入参非法 / 桥返回内容无法解析
export const CODE_DECRYPT_FAILED = 'DECRYPT_FAILED'; // 密钥失效，密文已被原生清除
export const CODE_UNAVAILABLE = 'UNAVAILABLE'; // 无桥（浏览器）或 KeyStore 故障

const KNOWN_CODES = [CODE_EMPTY, CODE_BAD_INPUT, CODE_DECRYPT_FAILED, CODE_UNAVAILABLE];

/**
 * 最近一次调用的错误码，供 UI 在不拆返回值的地方（如登录后自动填充失败）判断。
 * 空串表示上一次调用成功。ESM 的 `let` 导出是活绑定，import 方拿到的是最新值。
 */
export let lastCode = '';

/** 读取最近一次错误码（给不方便用活绑定的调用方，如 React 事件里读一次） */
export function getLastCode() {
  return lastCode;
}

/** 当前环境是否具备原生安全存储（同步、不抛异常） */
export function isAvailable() {
  try {
    const b = typeof window !== 'undefined' ? window.WeKnoraBridge : null;
    return Boolean(b && typeof b.saveCredentials === 'function');
  } catch {
    // 某些 WebView 实现对 window 代理取值会抛（极少见），一律当不可用
    return false;
  }
}

/** 取桥对象；无桥或取值异常时返回 null */
function bridge() {
  try {
    const b = typeof window !== 'undefined' ? window.WeKnoraBridge : null;
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}

/** 统一失败结果 */
function fail(code, message = '') {
  const safe = KNOWN_CODES.includes(code) ? code : CODE_BAD_INPUT;
  lastCode = safe;
  return { ok: false, code: safe, message };
}

/** 把原生返回的字符串解析成信封对象；空串 / 非法 JSON / 非对象 → null */
function parseEnvelope(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 非空字符串判断（不 trim 密码语义，但这里只用于「是否提供了值」） */
function isFilledString(value) {
  return typeof value === 'string' && value.length > 0;
}

/** email / baseUrl 用于校验时忽略首尾空白 */
function isFilledTrimmed(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * 调一次桥方法并归一化结果。
 * @param {string} method saveCredentials | loadCredentials | clearCredentials
 * @param {Array} args 传给桥方法的位置参数
 * @returns {Promise<{ok:true, data?:object}|{ok:false, code:string, message?:string}>}
 */
async function invoke(method, args) {
  const b = bridge();
  if (!b || typeof b[method] !== 'function') {
    return fail(CODE_UNAVAILABLE, '当前环境不支持安全保存密码');
  }
  let raw;
  try {
    // 桥方法是同步返回 String 的（@JavascriptInterface 同步调用在 WebView 里可用）
    raw = b[method](...args);
  } catch (err) {
    // WebView 跨语言调用可能抛（页面正在销毁、桥被移除、参数类型不被接受等）
    return fail(CODE_UNAVAILABLE, errorMessage(err));
  }

  const envelope = parseEnvelope(raw);
  if (!envelope) {
    // 桥返回了空串或非 JSON 文本：协议失配，当作入参/协议错误而不是崩溃
    return fail(CODE_BAD_INPUT, '原生返回内容无法解析');
  }
  if (envelope.ok === true) {
    lastCode = '';
    if (method === 'loadCredentials') {
      const data = normalizeCredentialData(envelope.data);
      if (!data) {
        // 原生说成功但字段不全：宁可报错让用户重输，也不要拿半份凭据去登录
        return fail(CODE_BAD_INPUT, '原生返回的凭据不完整');
      }
      return { ok: true, data };
    }
    return { ok: true };
  }
  const code = typeof envelope.code === 'string' ? envelope.code : '';
  return fail(code, typeof envelope.message === 'string' ? envelope.message : '');
}

/** 校验并裁剪原生返回的凭据对象；不合法返回 null */
function normalizeCredentialData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { email, password, baseUrl } = data;
  if (!isFilledTrimmed(email) || !isFilledString(password) || !isFilledTrimmed(baseUrl)) {
    return null;
  }
  return { email, password, baseUrl };
}

/** 取出异常的可读说明（WebView 抛的多是 "Java exception was raised…" 这类字符串） */
function errorMessage(err) {
  if (!err) return '原生调用失败';
  if (typeof err === 'string') return err;
  if (typeof err.message === 'string' && err.message) return err.message;
  return String(err);
}

/**
 * 保存登录凭据（加密后存设备，密钥在 AndroidKeystore 里）。
 * @param {{email:string, password:string, baseUrl:string}} cred
 * @returns {Promise<{ok:true}|{ok:false, code:string, message?:string}>}
 */
export async function save(cred) {
  if (!cred || typeof cred !== 'object' || Array.isArray(cred)) {
    return fail(CODE_BAD_INPUT, '缺少凭据参数');
  }
  const { email, password, baseUrl } = cred;
  if (!isFilledTrimmed(email) || !isFilledString(password) || !isFilledTrimmed(baseUrl)) {
    return fail(CODE_BAD_INPUT, 'email / password / baseUrl 都不能为空');
  }
  // email / baseUrl 去首尾空白（用户复制粘贴常带）；密码保持原样
  const payload = JSON.stringify({
    email: email.trim(),
    password,
    baseUrl: baseUrl.trim()
  });
  return invoke('saveCredentials', [payload]);
}

/**
 * 读取已保存的凭据。
 * @returns {Promise<{ok:true, data:{email:string,password:string,baseUrl:string}}|{ok:false, code:string, message?:string}>}
 *   code=EMPTY 表示从没保存过（正常路径，不是故障）；
 *   code=DECRYPT_FAILED 表示密钥失效、原生已清除损坏密文，需让用户重输。
 */
export async function load() {
  return invoke('loadCredentials', []);
}

/**
 * 清除已保存的凭据（原生会同时删除密文与 Keystore 密钥）。
 * @returns {Promise<{ok:true}|{ok:false, code:string, message?:string}>}
 */
export async function clear() {
  return invoke('clearCredentials', []);
}
