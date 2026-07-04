import { createContext, useContext, useState, useEffect } from 'react';
import { getConfig, setConfig as saveConfig } from '../config.js';

const ConfigContext = createContext(null);

export function ConfigProvider({ children }) {
  const [config, setConfigState] = useState(() => getConfig());

  const setConfig = (next) => {
    const merged = { ...config, ...next };
    setConfigState(merged);
    saveConfig(merged);
  };

  useEffect(() => {
    setConfigState(getConfig());
  }, []);

  return (
    <ConfigContext.Provider value={{ config, setConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

export function useConfig() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be inside ConfigProvider');
  return ctx;
}
