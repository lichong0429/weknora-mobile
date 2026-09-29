/**
 * 更新包的原生通道（下载到应用私有目录 + 交给系统安装器）。
 *
 * 为什么下载不走既有的 `WeKnoraBridge.download`：
 * 那条通道在 Android 10+ 会把文件写进 MediaStore 的「下载/WeKnora」，
 * 而系统安装器无法读取 MediaStore 的 content URI（也不该给它存储权限），
 * 必须由 FileProvider 从**应用自己的目录**授权出去。所以这里单独一条：
 * 下载到 <externalFilesDir>/update/，安装时用 FileProvider 换成 content:// URI。
 */

let seq = 0;

function bridge() {
  return (typeof window !== 'undefined' && window.WeKnoraBridge) || null;
}

/** 原生是否具备更新能力（下载 + 安装两个方法都要在） */
export function hasNativeUpdater() {
  const b = bridge();
  return Boolean(b && typeof b.downloadUpdate === 'function'
    && typeof b.installUpdate === 'function');
}

// 原生回调注册（与 nativeDownload.js 同一套约定：挂在 window 上，避免 HMR 丢状态）
if (typeof window !== 'undefined') {
  window.__weknoraUpdatePending = window.__weknoraUpdatePending || {};
  window.__weknoraUpdate = (requestId, ok, message) => {
    const entry = window.__weknoraUpdatePending[requestId];
    if (!entry) return;
    delete window.__weknoraUpdatePending[requestId];
    clearTimeout(entry.timer);
    if (ok) entry.resolve({ fileName: entry.fileName, path: message || '' });
    else entry.reject(new Error(message || '下载更新包失败'));
  };

  window.__weknoraInstallPending = window.__weknoraInstallPending || {};
  window.__weknoraInstall = (requestId, ok, message) => {
    const entry = window.__weknoraInstallPending[requestId];
    if (!entry) return;
    delete window.__weknoraInstallPending[requestId];
    clearTimeout(entry.timer);
    if (ok) entry.resolve({ message: message || '' });
    else entry.reject(new Error(message || '无法启动安装'));
  };
}

// 弱网下 6 MB 的包可能较慢，给 10 分钟
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 30 * 1000;

/** 下载更新包到应用私有目录；resolve({fileName, path}) */
export function downloadUpdate(url, fileName) {
  const b = bridge();
  if (!b || typeof b.downloadUpdate !== 'function') {
    return Promise.reject(new Error('当前环境不支持应用内更新'));
  }
  return new Promise((resolve, reject) => {
    const requestId = `up_${Date.now().toString(36)}_${++seq}`;
    const pending = window.__weknoraUpdatePending;
    const timer = setTimeout(() => {
      delete pending[requestId];
      reject(new Error('下载超时，请检查网络后重试'));
    }, DOWNLOAD_TIMEOUT_MS);
    pending[requestId] = { resolve, reject, timer, fileName };
    try {
      b.downloadUpdate(url, fileName, requestId);
    } catch (err) {
      clearTimeout(timer);
      delete pending[requestId];
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/**
 * 交给系统安装器。**注意：Android 不允许应用静默安装**，这里只是把安装界面调起来，
 * 最后一步「安装」必须由用户点击确认（首次还需先授权「安装未知应用」）。
 */
export function installUpdate(fileName) {
  const b = bridge();
  if (!b || typeof b.installUpdate !== 'function') {
    return Promise.reject(new Error('当前环境不支持应用内安装'));
  }
  return new Promise((resolve, reject) => {
    const requestId = `in_${Date.now().toString(36)}_${++seq}`;
    const pending = window.__weknoraInstallPending;
    const timer = setTimeout(() => {
      delete pending[requestId];
      // 超时多为「已拉起安装界面、用户在操作」，不当作失败
      resolve({ message: '' });
    }, INSTALL_TIMEOUT_MS);
    pending[requestId] = { resolve, reject, timer };
    try {
      b.installUpdate(fileName, requestId);
    } catch (err) {
      clearTimeout(timer);
      delete pending[requestId];
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

/** 非原生环境（PWA / 浏览器）：打开 Release 页面让用户自行下载 */
export function openReleasePage(url) {
  try {
    window.open(url, '_blank', 'noopener');
    return true;
  } catch {
    return false;
  }
}
