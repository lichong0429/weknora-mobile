import { buildApiUrl, downloadAsBlob } from '../api/client.js';
import { getApiKey } from '../config.js';

// 统一的文件下载入口。
//
// 背景：Android WebView **不实现** blob: 下载，也会忽略 <a download>，
// 因此「前端 fetch → blob → a[download]」在 App 内是死路（原有的
// KnowledgeDetail「下载文件」按钮实际一直无效）。App 内必须把请求交给原生：
// 原生侧流式写盘，避免 ZIP 一次性进内存（后端批量下载上限 512 MiB）。
// 非原生环境（PWA / 桌面浏览器）则回退到 blob 下载。

let seq = 0;

export function hasNativeDownload() {
  return typeof window !== 'undefined'
    && window.WeKnoraBridge
    && typeof window.WeKnoraBridge.download === 'function';
}

// 原生下载的完成/失败回调由 MainActivity 通过 evaluateJavascript 调回。
if (typeof window !== 'undefined' && !window.__weknoraDownload) {
  window.__weknoraDownload = (requestId, ok, message) => {
    const pending = window.__weknoraDownloadPending || {};
    const entry = pending[requestId];
    if (!entry) return;
    delete pending[requestId];
    clearTimeout(entry.timer);
    if (ok) entry.resolve({ fileName: entry.fileName, message });
    else entry.reject(new Error(message || '下载失败'));
  };
  window.__weknoraDownloadPending = {};
}

// 原生下载：默认 10 分钟超时（大 ZIP 在弱网下可能较慢）
const NATIVE_TIMEOUT_MS = 10 * 60 * 1000;

function nativeDownload({ path, method = 'GET', body = null, fileName }) {
  return new Promise((resolve, reject) => {
    const requestId = `dl_${Date.now().toString(36)}_${++seq}`;
    const pending = window.__weknoraDownloadPending;
    const timer = setTimeout(() => {
      delete pending[requestId];
      reject(new Error('下载超时，请检查网络后重试'));
    }, NATIVE_TIMEOUT_MS);

    pending[requestId] = { resolve, reject, timer, fileName };

    try {
      window.WeKnoraBridge.download(
        method,
        buildApiUrl(path),
        body ? JSON.stringify(body) : '',
        fileName || 'download',
        getApiKey(),
        requestId
      );
    } catch (err) {
      clearTimeout(timer);
      delete pending[requestId];
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * 下载一个后端文件。
 * @param {object} opts
 * @param {string} opts.path     API 路径（如 /knowledge/{id}/download）
 * @param {string} [opts.method] GET / POST
 * @param {object} [opts.body]   POST 请求体
 * @param {string} opts.fileName 建议文件名（含扩展名）
 * @returns {Promise<{fileName: string, via: 'native'|'browser', message?: string}>}
 */
export async function saveFile({ path, method = 'GET', body = null, fileName = 'download' }) {
  if (hasNativeDownload()) {
    const res = await nativeDownload({ path, method, body, fileName });
    return { ...res, via: 'native' };
  }
  const res = await downloadAsBlob(path, { method, body, fileName });
  return { ...res, via: 'browser' };
}

// 生成一个 safe 的文件名片段（用于批量下载时按知识库名命名 ZIP）
export function safeFileName(name, fallback = 'download') {
  const cleaned = String(name || '')
    .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}
