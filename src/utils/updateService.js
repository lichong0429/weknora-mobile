/**
 * 检查更新的服务层：负责取数据（fetch + 缓存），判定交给 updateChecker（纯逻辑）。
 *
 * 【v1.9.1】不再"静默跳过"：失败时通过 onStatus 回报原因（如网络不可达），
 * 否则用户只看到"没弹窗"，完全无法判断是功能坏了还是本来就没有更新。
 */
import { APP_VERSION } from './appVersion.js';
import {
  RELEASE_LATEST_API,
  evaluateUpdate,
  readCache,
  writeCache,
  getSkippedVersion
} from './updateChecker.js';

const FETCH_TIMEOUT_MS = 12000;

async function fetchJson(url) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      cache: 'no-store',
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * @param {object} options
 * @param {boolean} [options.force]  跳过缓存强制重查（设置页「检查更新」用）
 * @param {string}  [options.currentVersion]
 * @param {(s: object) => void} [options.onStatus] 状态回报（排障用）
 * @returns {Promise<{status:'update'|'latest'|'unknown'|'error', release?: object,
 *                    skipped?: boolean, reason?: string, fromCache?: boolean}>}
 */
export async function checkForUpdate({ force = false, currentVersion = APP_VERSION, onStatus } = {}) {
  const report = (patch) => { try { onStatus?.(patch); } catch {} };
  let release = null;
  let fromCache = false;

  if (!force) {
    const cached = readCache();
    if (cached && cached.release) {
      release = cached.release;
      fromCache = true;
    }
  }

  if (!release) {
    try {
      const raw = await fetchJson(RELEASE_LATEST_API);
      const verdict = evaluateUpdate(raw, currentVersion);
      // 无效响应（没有 APK 资产等）不入缓存，下次再试
      if (verdict.status === 'invalid') {
        report({ status: 'error', reason: 'invalid' });
        return { status: 'error', reason: 'invalid' };
      }
      release = verdict.release || null;
      if (!release) {
        report({ status: 'error', reason: 'no-release' });
        return { status: 'error', reason: 'no-release' };
      }
      // 缓存分档：判定为「有更新」才走长档（6h），否则短档（30min）
      writeCache(release, verdict.status === 'update');
    } catch (err) {
      // 断网 / 限流 / 被拦截 —— 不弹窗、不打扰，但必须留下可查的原因
      const reason = (err && err.name === 'AbortError') ? 'timeout' : (err?.message || 'network');
      report({ status: 'unknown', reason });
      return { status: 'unknown', reason };
    }
  }

  const verdict = evaluateUpdate(release, currentVersion);
  if (verdict.status !== 'update') {
    report({ status: 'latest', fromCache });
    return { status: 'latest', fromCache };
  }

  const skipped = getSkippedVersion() === release.version;
  report({ status: 'update', release, skipped, fromCache });
  return { status: 'update', release, skipped, fromCache };
}
