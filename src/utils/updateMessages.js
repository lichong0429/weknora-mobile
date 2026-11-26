/**
 * 「检查更新失败」的原因码 → 可翻译文案。
 *
 * 为什么单独成文件（纯 JS，无 React/无 DOM）：
 *   1. 失败文案要随界面语言切换 —— 所以返回的是 `{ key, params }` 而不是翻译好的字符串，
 *      由调用方在**渲染期**翻译（与 noticeText 的约定一致，避免存"翻译快照"）；
 *   2. Node 能直接 import，`scripts/test-update-check.mjs` 可以断言映射关系，
 *      尤其"限流"与"数据缺字段"这两类必须给出不同的话 —— 老版本把它们混成一句，
 *      导致用户看到"可能触发了匿名接口限流"这种与实际原因无关的提示。
 *
 * 原因码来自 updateService.checkForUpdate()：
 *   'timeout'    fetch 被 AbortController 掐断
 *   'invalid'    返回了内容但没有可用发布（无 tag / 无 APK 资产）
 *   'no-release' 兜底：接口有内容但拼不出 release（理论上不可达）
 *   'HTTP 403' / 'HTTP 429' / 其它 'HTTP xxx'
 *   其它        网络错误原文（如 'Failed to fetch'）
 */

/** 判定是否为 GitHub 限流类的 HTTP 状态（403 也可能来自权限，但在这个公开接口上基本都是限流） */
export function isRateLimitReason(reason) {
  if (typeof reason !== 'string') return false;
  const m = reason.match(/^HTTP\s+(\d{3})$/i);
  if (!m) return false;
  const status = Number(m[1]);
  return status === 403 || status === 429;
}

/**
 * 把失败原因码转成 `{ key, params }`，交给调用方在渲染期 `t(key, params)`。
 *
 * @param {string} reason 原因码（可能为空）
 * @returns {{ key: string, params?: Record<string, unknown> }}
 */
export function describeCheckFailure(reason) {
  const code = typeof reason === 'string' ? reason.trim() : '';
  if (!code) return { key: 'settings.updateFailUnknown' };

  if (code === 'timeout') return { key: 'settings.updateFailTimeout' };
  if (code === 'invalid') return { key: 'settings.updateFailInvalid' };
  // 注意文案：这里只说"接口返回的数据里没有可用的发布信息"，
  // 不能再说"可能触发了匿名接口限流" —— 限流会抛 HTTP 403，走下面的分支。
  if (code === 'no-release') return { key: 'settings.updateFailNoRelease' };

  if (isRateLimitReason(code)) {
    return { key: 'settings.updateFailRateLimited', params: { status: code } };
  }
  if (/^HTTP\s+/i.test(code)) {
    return { key: 'settings.updateFailHttp', params: { status: code } };
  }
  return { key: 'settings.updateFailNetwork' };
}

export default describeCheckFailure;
