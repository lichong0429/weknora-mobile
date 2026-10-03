import { createContext, useContext, useState, useEffect } from 'react';
import { getConfig, setConfig as saveConfig } from '../config.js';

const ConfigContext = createContext(null);

const THEME_KEY = 'weknora-mobile-theme';

function getStoredTheme() {
  try { return localStorage.getItem(THEME_KEY) || 'system'; } catch { return 'system'; }
}

function storeTheme(t) {
  try { localStorage.setItem(THEME_KEY, t); } catch {}
}

// 计算实际生效的暗色状态；'system' 时跟随系统 prefers-color-scheme
function resolveIsDark(theme) {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

function applyThemeClass(theme) {
  const dark = resolveIsDark(theme);
  const root = document.documentElement;
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  // 同步原生层（WebView JS 桥）：传 theme + 实际明暗布尔值，控制状态栏/导航栏背景与图标颜色。
  // 关键：原生 App 主题改 DayNight 后，WebView 的 prefers-color-scheme 才能正确跟随系统，
  // 「跟随系统」档才会真正随系统深色/浅色切换。
  try {
    window.WeKnoraBridge?.setTheme(theme, dark);
  } catch {
    // 浏览器预览等非原生环境忽略
  }
  return dark;
}

export function ConfigProvider({ children }) {
  const [config, setConfigState] = useState(() => getConfig());
  const [theme, setThemeState] = useState(() => getStoredTheme());

  const setConfig = (next) => {
    const merged = { ...config, ...next };
    setConfigState(merged);
    saveConfig(merged);
  };

  const setTheme = (next) => {
    const t = next || 'system';
    setThemeState(t);
    storeTheme(t);
    applyThemeClass(t);
  };

  useEffect(() => {
    setConfigState(getConfig());
  }, []);

  // 监听 config.js 的写操作。
  //
  // 【v1.9.2 修正】api/auth.js（登录成功、写 token、退出登录）为了在非 React 环境
  // 也能用，直接调 config.js 的 setConfig —— 那只写 localStorage，不通知 React。
  // 结果：登录成功后界面毫无变化、RequireAuth 守卫也读不到新状态，
  // 表现为「点了登录没反应、设置里还显示 API Key 登录」。
  // 这里订阅事件把外部写入同步进 Context，打通两条路径。
  useEffect(() => {
    const onChange = (e) => {
      setConfigState(e.detail || getConfig());
    };
    window.addEventListener('weknora-config-changed', onChange);
    return () => window.removeEventListener('weknora-config-changed', onChange);
  }, []);

  // 多标签页/多 WebView 实例共享 localStorage 时也应同步
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === 'weknora-mobile-config') setConfigState(getConfig());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // 应用初始主题 + 跟随系统主题变化（仅当 theme === 'system' 时联动）
  useEffect(() => {
    applyThemeClass(theme);
    const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    if (!mq) return undefined;
    const onChange = () => {
      if (getStoredTheme() === 'system') applyThemeClass('system');
    };
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, [theme]);

  return (
    <ConfigContext.Provider value={{ config, setConfig, theme, setTheme }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be inside ConfigProvider');
  return ctx;
}
