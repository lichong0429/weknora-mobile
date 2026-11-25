/**
 * 登录页的「状态决策」纯函数集合。
 *
 * 为什么独立成文件（纯 JS，可被 Node 直接 import）：
 *   - 组件里的状态机要 DOM 才能驱动，但「401 后要不要删本机密文」这种判断
 *     属于安全/隐私相关逻辑，不能只靠肉眼 review；
 *   - `Login.jsx` 只保留组件导出，Fast Refresh 才不会退化成整页刷新。
 */
import { normalizeBaseUrl, planRestore } from './baseUrlIdentity.js';

/**
 * 勾选「保存密码」时的副作用决策。
 *
 * 入参容错：`planSaveToggle()` / `planSaveToggle(null)` 不得抛错（挂在登录页交互路径上）。
 *
 * @param {{ next: boolean, available: boolean }|null} [input] 目标勾选值 / 原生安全存储是否可用
 * @returns {{ persist: boolean, clearStore: boolean, notice: ''|'unavailable'|'off' }}
 *   - 勾上但环境不支持 → `unavailable`（提示「当前环境不支持安全存储」，不是错误，不弹红条）
 *   - 取消勾选且可用 → `clearStore: true`（立刻清掉本机密文，不留看不见的密码）
 */
export function planSaveToggle(input = {}) {
  const { next, available } = input || {};
  const on = Boolean(next);
  return {
    persist: true,
    clearStore: !on && Boolean(available),
    notice: on ? (available ? '' : 'unavailable') : (available ? 'off' : '')
  };
}

/**
 * 401 回退的状态决策。
 *
 * 401 = 服务端明确否掉了「刚才提交的那组凭据」。但**它否掉的是哪台服务器的凭据**，
 * 决定了我们能不能连本机存的密文一起删 —— 这里有两个必须挡住的丢数据场景：
 *
 *  1. **跨站**：A 站存过密码 → 用户在 B 站手滑输错一次 → 404/401 回来。
 *     这份密文属于 A 且仍然有效，删掉就是无感知的数据丢失（提示还被 had 拦住，用户更察觉不到）。
 *     ⚠️ 注意 `hasSavedPassword` 对跨站**也是 true**：`Login.jsx` 的回填分支只要
 *     `load()` 成功就置 true（让「清除」入口在不回填密码的情况下也能点到），
 *     所以单靠 `hadSaved` 挡不住跨站 —— 必须再叠一层地址比较。
 *     把下面这行 `&& sameServerNow` 当"冗余"删掉，跨站与"改地址"两条路径会立刻回归。
 *  2. **同源回填后又手动改地址**：A 站回填密码（`hasSavedPassword = true`）→ 用户把地址
 *     改成 B → 在 B 站登录 401。此时 `hasSavedPassword` 仍为 true，但它描述的是
 *     **上次 load() 那一刻**的判定，已经过期了。所以这里必须拿
 *     「密文里记的地址」与「**当前**地址」重新比一次。
 *     同理：登录成功后新存一份密码，也要同步记录 `savedServerUrl`，否则这份新密文
 *     在"地址未知"退化下会被下一次 401 误清（场景 G）。
 *
 * 因此 `hadSaved` 会被 `sameServerNow` 再收敛一次：
 *   - 两侧地址都已知 → 用 `planRestore().sameServer` 判定；
 *   - 任一侧未知（密文没地址、异常数据）→ **fail-safe：不删**。
 *     即"无法确认这份密文属于当前服务器"时，按**不安全侧**处理：宁可让用户重输一次
 *     密码，也不静默删库。理由是两侧代价不对称 —— 删除会连 Keystore 密钥一起清掉，
 *     **不可恢复**（重装都找不回来）；而不删最多是"该清的没清"，用户重输即可恢复。
 *     注意：这不是"退化为旧行为"——旧行为在这里是**删**，那才是危险的默认值。
 *
 * 勾选框是**偏好**（下次登录是否尝试保存），「已保存」徽标才是**状态**，两者不混。
 *
 * 入参容错：`planStaleCredential()` / `planStaleCredential(null)` 不得抛错。
 *
 * @param {{ hadSaved?: boolean, savedServerUrl?: string, currentBaseUrl?: string }|null} [input]
 *   `savedServerUrl`：密文里记录的服务器地址；`currentBaseUrl`：**当前**登录页上的地址。
 * @returns {{ clearPassword: boolean, clearStore: boolean, uncheck: boolean,
 *             showExpiredNotice: boolean, clearSavedBadge: boolean, sameServerNow: boolean }}
 *   - `clearPassword`：**无条件** true —— 401 说明输入框里那串就是错的，留着只会误导；
 *   - 其余四项都要求 `hadSaved && sameServerNow`（确认是本机这台服务器的密文才动）；
 *     地址未知时 `sameServerNow === false`（fail-safe），因此一律不删；
 *   - `clearSavedBadge`：只有真的清掉了才把「已保存」徽标置否（跨站手滑不许让徽标消失）。
 */
export function planStaleCredential(input = {}) {
  const { hadSaved, savedServerUrl, currentBaseUrl } = input || {};
  const savedKnown = Boolean(normalizeBaseUrl(savedServerUrl));
  const currentKnown = Boolean(normalizeBaseUrl(currentBaseUrl));
  const addressesKnown = savedKnown && currentKnown;
  const sameServerNow = addressesKnown
    ? planRestore({ savedBaseUrl: savedServerUrl, currentBaseUrl }).sameServer
    : false; // fail-safe：地址未知 = 无法确认归属 → 不删（删除不可恢复，见上）
  const had = Boolean(hadSaved) && sameServerNow;
  return {
    clearPassword: true,
    clearStore: had,
    uncheck: had,
    showExpiredNotice: had,
    clearSavedBadge: had,
    sameServerNow
  };
}
