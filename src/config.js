const CONFIG_KEY = 'weknora-mobile-config';

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
  } catch {
    return {};
  }
}

export function setConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

export function getBaseUrl() {
  const cfg = getConfig();
  if (cfg.useProxy) return '';
  return (cfg.baseUrl || 'http://localhost:8080').replace(/\/$/, '');
}

export function getApiKey() {
  const cfg = getConfig();
  if (cfg.useProxy) return '';
  return cfg.apiKey || '';
}
