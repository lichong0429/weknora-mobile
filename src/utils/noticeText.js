/**
 * 提示语（notice）的渲染器。
 *
 * 背景 —— 这是一类真实 bug 的修法，不是风格问题：
 *   原来组件把 `t('…')` 的**结果**存进 state（`secureNotice` / `status` / `updateMsg` …），
 *   等于给提示语拍了一张"翻译快照"。用户切换界面语言后，静态文案全变了、提示语却停在
 *   旧语言 —— 英文界面里会残留一条中文提示，反之亦然。
 *   正确做法：state 里只存 **key + params**，渲染时再翻译。
 *
 * notice 的形态（全部字段可选）：
 *   { type: 'info'|'warn'|'error',        // 只影响样式，与文案无关
 *     key: 'login.secureOtherServer',     // 词典键
 *     params: { host: 'a.example.com' },  // 插值参数（用户/技术数据，不进词典）
 *     fallbacks: { detail: 'common.unknownError' },
 *                                         // params 里某值为空时，用这里给的**键**取译文兜底
 *     raw: 'HTTP 500 …',                  // 服务端原文，原样显示（优先于 key）
 *     fallbackKey: 'settings.testFailed', // raw 为空时用的键
 *     appendTo: prevNotice }              // 在上一段提示后面追加一行（只允许一层）
 *
 * 服务端返回的文本（`err.message` 等）**绝不进词典**：它不属于我们的文案，
 * 翻译它只会得到"未翻译的 {detail}"这种更难看的东西。走 `raw` / `params.detail`。
 *
 * 纯 JS 无 React 依赖 —— Node 可直接 import 做断言（见 scripts/ 下的回归测试）。
 */

/**
 * appendTo 只支持一层。出现两层属于结构性误用（该改用数组了），但这里**不抛错**：
 * 本函数运行在渲染期，抛错就是白屏 —— 而这轮修的故障（hooks 顺序、401 误删）
 * 全是"渲染期出问题"这一类，不能用新的渲染期异常去兜一个注释级约束。
 * 处置：生产只取最内层那一层拼接、忽略更深层；DEV 下 console.warn 让它可见。
 */
const NESTED_APPEND_WARNING =
  '[noticeText] appendTo 只允许一层嵌套，已忽略更深层；多段提示请改用数组结构';

/** 是否 development 构建（release 下恒 false，保证静默） */
function isDevBuild() {
  try {
    return Boolean(import.meta && import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
}

/**
 * 把 params 里为空的值用 fallbacks 指定的键译文补齐。
 *
 * @param {{ params?: Record<string, unknown>, fallbacks?: Record<string, string> }} notice
 * @param {(key: string, params?: Record<string, unknown>) => string} translate
 * @returns {Record<string, unknown>} 补齐后的参数表（不修改入参对象）
 */
function resolveParams(notice, translate) {
  const params = { ...(notice.params || {}) };
  const fallbacks = notice.fallbacks || {};
  for (const name of Object.keys(fallbacks)) {
    const value = params[name];
    // 只补"真的没有值"的情况；false / 0 是合法参数，不能被当成空
    if (value === undefined || value === null || value === '') {
      params[name] = translate(fallbacks[name]);
    }
  }
  return params;
}

/**
 * 单段（不含 appendTo）的文案。
 *
 * @param {object|null|undefined} notice
 * @param {(key: string, params?: Record<string, unknown>) => string} translate
 * @returns {string} 空串表示"这段没有可显示文本"（调用方据此不渲染）
 */
function segmentText(notice, translate) {
  if (!notice || typeof notice !== 'object') return '';
  // 服务端原文优先：它已经是最终文本，翻译它没有意义
  if (typeof notice.raw === 'string' && notice.raw !== '') return notice.raw;
  if (typeof notice.key === 'string' && notice.key !== '') {
    return translate(notice.key, resolveParams(notice, translate));
  }
  if (typeof notice.fallbackKey === 'string' && notice.fallbackKey !== '') {
    return translate(notice.fallbackKey);
  }
  return '';
}

/**
 * 把一条 notice 渲染成最终文案（随 `t` 的语言变化而变化）。
 *
 * @param {object|null|undefined} notice 见文件头的形态说明
 * @param {(key: string, params?: Record<string, unknown>) => string} t useI18n() 的 t
 * @returns {string} 可直接放进 JSX 的文本；notice 为空时返回 ''
 */
export function noticeText(notice, t) {
  if (!notice || typeof notice !== 'object') return '';
  // t 不是函数时退化为"返回键名"，保证渲染期永远不因缺 t 而崩
  const translate = typeof t === 'function' ? t : (key) => key;

  if (notice.appendTo) {
    // 只允许一层：appendTo.appendTo 存在时忽略更深层（不抛错、不白屏，见上方说明）
    if (notice.appendTo.appendTo && isDevBuild()) console.warn(NESTED_APPEND_WARNING);
    const head = segmentText(notice.appendTo, translate);
    const tail = segmentText(notice, translate);
    return [head, tail].filter(Boolean).join('\n');
  }
  return segmentText(notice, translate);
}

export default noticeText;
