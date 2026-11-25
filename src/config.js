const CONFIG_KEY = 'weknora-mobile-config';

// 配置默认值。
//
// 配置本身是「按需写入」的稀疏对象（老版本用户只有 apiKey + baseUrl），
// 所以默认值放在读取侧兜底：各处直接读字段即可，不用到处写 `!== false`。
//
// savePassword：登录页「保存密码」勾选框的状态。
//   默认 true（勾选）——密码只走原生 Keystore 加密通道（见 utils/secureStore.js），
//   且**只有登录成功才会写入**；用户在无桥环境（浏览器）下不会真的落盘。
const DEFAULT_CONFIG = {
  savePassword: true
};

export function getConfig() {
  try {
    const stored = JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    return { ...DEFAULT_CONFIG, ...stored };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

// 写入配置：**合并**而非覆盖。
//
// 【v1.9.2 修正】原先是 `JSON.stringify(cfg)` 整体覆盖，
// 而 api/auth.js 传的是局部字段（authToken / authEmail…），
// 于是登录一次就把之前存的 apiKey、baseUrl 一起抹掉 —— 用户反馈
//「登录后设置里显示的还是 API Key 信息」的另一半原因。
export function setConfig(patch) {
  const merged = { ...getConfig(), ...patch };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(merged));
  // 通知订阅者（ConfigContext 监听此事件），否则 React 侧状态不会更新
  try {
    window.dispatchEvent(new CustomEvent('weknora-config-changed', { detail: merged }));
  } catch {
    // 非浏览器环境（测试）忽略
  }
  return merged;
}

export function getBaseUrl() {
  const cfg = getConfig();
  return (cfg.baseUrl || 'http://localhost:8080').replace(/\/$/, '');
}

export function getApiKey() {
  const cfg = getConfig();
  return cfg.apiKey || '';
}

export function getAuthToken() {
  const cfg = getConfig();
  return cfg.authToken || '';
}
