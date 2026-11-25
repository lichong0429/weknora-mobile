import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LANG, LANG_STORAGE_KEY, createT, resolveLang } from './index.js';

/**
 * 语言上下文。
 *
 * **切换语言不清空任何输入** —— 这一点是硬约束，实现上靠两条：
 *  1. `I18nProvider` 只提供 value（`{ lang, setLang, t }`），切换语言只是让它
 *     重新渲染子树（同一批 fiber、同一份组件状态），**从不改 key、从不换组件类型**；
 *  2. 全仓库禁止出现 `key={lang}` / `<Component key={lang}/>` 这类「靠 key 触发重挂载」
 *     的手法。重挂载会丢掉 Chat 输入框的草稿、Login 表单的邮箱与密码、
 *     以及会话页正在流式输出的消息。任何需要「切语言后刷新」的错觉都是伪需求 ——
 *     React 的渲染本来就跟着 `t` 的新引用重跑。
 */
const I18nContext = createContext(null);

/** 从 localStorage 读取上次选择的语言（隐私模式/禁用存储时静默回退）。 */
function readStoredLang() {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 持久化语言选择（失败不影响当前会话）。 */
function storeLang(lang) {
  try {
    localStorage.setItem(LANG_STORAGE_KEY, lang);
  } catch {
    // localStorage 不可用（隐私模式、配额满）时忽略：本次会话仍然生效
  }
}

/**
 * 提供 `lang` / `setLang` / `t`。
 *
 * @param {{ children: React.ReactNode }} props
 */
export function I18nProvider({ children }) {
  // 初值：已存偏好 → 规范化；没有则用 DEFAULT_LANG
  const [lang, setLangState] = useState(() => resolveLang(readStoredLang() || DEFAULT_LANG));

  const setLang = useCallback((next) => {
    const resolved = resolveLang(next);
    storeLang(resolved);
    setLangState(resolved);
  }, []);

  // t 随语言重建：下游组件拿到新的函数引用后自然重渲染
  const t = useMemo(() => createT(lang), [lang]);

  // 同步 <html lang>：影响读屏、字体选择、浏览器「翻译此页」提示与断行规则
  useEffect(() => {
    try {
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang;
    } catch {
      // 非浏览器环境（理论不存在）忽略
    }
  }, [lang]);

  const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * 读取 i18n 上下文。
 *
 * @returns {{ lang: string, setLang: (lang: string) => void,
 *            t: (key: string, params?: Record<string, unknown>) => string }}
 */
export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be inside I18nProvider');
  return ctx;
}

export default I18nContext;
