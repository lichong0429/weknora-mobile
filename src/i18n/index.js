/**
 * i18n 内核 —— **纯 JS，不依赖 React、不依赖浏览器 API**。
 *
 * 之所以单独成文件（而不是塞进 I18nContext.jsx）：
 * `scripts/test-i18n.mjs` 要能直接 `import` 它做回归断言，而 Node 侧 import 不了 JSX。
 *
 * 设计要点：
 *  1. 三级回退 `dict[lang][key] ?? zh[key] ?? key` —— 任何缺失都不会渲染成空白，
 *     也不会把键名直接甩到用户脸上（最差回退到中文真源）。
 *  2. 参数替换是**单遍扫描**，不用 `String.prototype.replace(pattern, …)`：
 *     传进来的值里若有 `$&` / `$1` 之类会被 replace 当成替换语义吃掉，
 *     而本函数只认 `{name}` 字面量，插入的值不会再被二次扫描。
 *  3. 开发期缺键告警只在 `import.meta.env.DEV` 为真时输出；release 构建静默。
 */
import zh from './zh.js';
import en from './en.js';

/** 真源语言：任何语言缺键都回退到这里。 */
export const DEFAULT_LANG = 'zh';

/** 支持的语言列表（顺序即设置页展示顺序）。 */
export const LANGS = ['zh', 'en'];

/** localStorage 持久化键（不要改，改了等于清空所有用户的偏好）。 */
export const LANG_STORAGE_KEY = 'weknora-mobile-lang';

/**
 * 字典命名空间白名单。
 * 键名必须匹配 `^(common|nav|login|settings|home|kbList|kbDetail|chat|sessionList|search)\.[\w.]+$`，
 * 由 test-i18n.mjs 的第 7 组断言守住。
 */
export const KEY_PREFIXES = [
  'common',
  'nav',
  'login',
  'settings',
  'home',
  'kbList',
  'kbDetail',
  'chat',
  'sessionList',
  'search'
];

/** 语言 → 字典。新增语言时同时更新 LANGS。 */
export const DICTS = { zh, en };

/**
 * 把任意输入规范成受支持的语言代码。
 * @param {unknown} lang 候选语言（可能来自 localStorage，可能是 null/undefined/脏数据）
 * @returns {string} LANGS 中的一个；非法值一律回退 DEFAULT_LANG
 */
export function resolveLang(lang) {
  if (typeof lang !== 'string') return DEFAULT_LANG;
  const normalized = lang.trim().toLowerCase();
  // 允许传 'zh-CN' / 'en-US' 这类带地区码的值：取主语言标签
  const primary = normalized.split('-')[0];
  return LANGS.includes(primary) ? primary : DEFAULT_LANG;
}

/**
 * 是否处于开发模式（release 构建下恒为 false，保证构建产物静默）。
 * @returns {boolean}
 */
function isDevBuild() {
  try {
    return Boolean(import.meta && import.meta.env && import.meta.env.DEV);
  } catch {
    return false;
  }
}

/**
 * 单遍替换 `{name}` 占位符。
 *
 * 只替换 `params` 里真实存在的键；不存在的占位符原样保留（便于看出是哪个参数漏了）。
 * 插入的值**不会**被再次扫描，因此值里出现 `{` / `}` 也不会被误替换。
 *
 * @param {string} template 含 `{name}` 占位符的模板
 * @param {Record<string, unknown>} [params] 参数表
 * @returns {string}
 */
function interpolate(template, params) {
  if (!params || typeof params !== 'object') return template;
  let out = '';
  let index = 0;
  while (index < template.length) {
    const char = template[index];
    if (char === '{') {
      const end = template.indexOf('}', index + 1);
      if (end > index + 1) {
        const name = template.slice(index + 1, end);
        if (Object.prototype.hasOwnProperty.call(params, name)) {
          const value = params[name];
          out += value === null || value === undefined ? '' : String(value);
          index = end + 1;
          continue;
        }
      }
    }
    out += char;
    index += 1;
  }
  return out;
}

/**
 * 取译文，带三级回退。
 *
 * @param {string} lang 目标语言（非法值回退 DEFAULT_LANG）
 * @param {string} key 扁平键名，如 `home.title`
 * @param {Record<string, unknown>} [params] `{name}` 参数
 * @returns {string} 译文；三级回退全部落空时返回 key 本身
 */
export function translate(lang, key, params) {
  const resolved = resolveLang(lang);
  if (typeof key !== 'string' || key === '') return '';
  const dict = DICTS[resolved] || {};
  const fallbackDict = DICTS[DEFAULT_LANG] || {};

  let value = dict[key];
  if (typeof value !== 'string') {
    const fallback = fallbackDict[key];
    if (typeof fallback === 'string') {
      value = fallback;
      // 目标语言缺键 → 用中文兜住：功能可用，但翻译漏了，开发期必须能看见
      if (resolved !== DEFAULT_LANG && isDevBuild()) {
        console.warn('[i18n] missing', resolved, key);
      }
    } else {
      // 连真源都没有 → 直接暴露键名，同时告警（这是词典本身的缺陷）
      value = key;
      if (isDevBuild()) {
        console.warn('[i18n] missing', resolved, key);
      }
    }
  }
  return interpolate(value, params);
}

/**
 * 生成绑定到某个语言的翻译函数（供 React 侧 `useMemo` 缓存）。
 *
 * @param {string} lang 目标语言
 * @returns {(key: string, params?: Record<string, unknown>) => string}
 */
export function createT(lang) {
  const resolved = resolveLang(lang);
  return function t(key, params) {
    return translate(resolved, key, params);
  };
}
