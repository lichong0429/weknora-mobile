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
