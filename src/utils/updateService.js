/**
 * 检查更新的服务层：负责取数据（fetch + 缓存），判定交给 updateChecker（纯逻辑）。
 * 所有失败都收敛成 status:'unknown'，调用方据此静默跳过，不打扰启动流程。
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
 * @param {{force?: boolean, currentVersion?: string}} options
 * @returns {Promise<{status:'update'|'latest'|'unknown', release?: object, skipped?: boolean}>}
 */
export async function checkForUpdate({ force = false, currentVersion = APP_VERSION } = {}) {
  let release = null;

  if (!force) {
    const cached = readCache();
    if (cached && cached.release) release = cached.release;
  }

  if (!release) {
    try {
      const raw = await fetchJson(RELEASE_LATEST_API);
      const verdict = evaluateUpdate(raw, currentVersion);
      // 无效响应（没有 APK 资产等）不入缓存，下次再试
      if (verdict.status === 'invalid') return { status: 'unknown' };
      release = verdict.release || null;
      if (release) writeCache(release);
      if (!release) return { status: 'latest' };
    } catch {
      // 断网 / 限流 / 被拦截 —— 静默跳过，绝不影响使用
      return { status: 'unknown' };
    }
  }

  const verdict = evaluateUpdate(release, currentVersion);
  if (verdict.status !== 'update') return { status: verdict.status === 'invalid' ? 'unknown' : 'latest' };

  const skipped = getSkippedVersion() === release.version;
  return { status: 'update', release, skipped };
}
