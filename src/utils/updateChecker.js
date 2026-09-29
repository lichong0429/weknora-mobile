/**
 * 启动时检查更新：拉取 GitHub Releases 的 latest，与当前版本比对。
 *
 * 设计取舍：
 * - 只依赖 GitHub 公开 API（仓库是 public，无需令牌）。api.github.com 会返回
 *   `Access-Control-Allow-Origin: *`，所以 WebView 里直接 fetch 是可行的。
 * - 本模块**只做纯逻辑**（解析 / 版本比较 / 决策），不碰 fetch、不碰原生桥、
 *   不碰 React —— 这样能用 scripts/test-update-check.mjs 把判定规则锁死。
 * - 任何异常都归为「无法确定」，绝不因为检查更新失败而干扰启动。
 */

export const UPDATE_REPO = 'lichong0429/weknora-mobile';

export const RELEASE_LATEST_API =
  `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`;

export const RELEASES_PAGE = `https://github.com/${UPDATE_REPO}/releases`;

/** 把 "v1.7.5" / "1.7.5" / "1.7" / "1.7.5-beta.1" 解析成 [major, minor, patch]；无法解析返回 null */
export function parseVersion(input) {
  if (input === null || input === undefined) return null;
  const m = String(input).trim().match(/^[vV]?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1] || 0), Number(m[2] || 0), Number(m[3] || 0)];
}

/** 逐段比较：a>b 返回 1，a<b 返回 -1，相等返回 0；无法解析的一侧视为 0.0.0 */
export function compareVersions(a, b) {
  const pa = parseVersion(a) || [0, 0, 0];
  const pb = parseVersion(b) || [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] > pb[i]) return 1;
    if (pa[i] < pb[i]) return -1;
  }
  return 0;
}

/** latest 是否比 current 新 */
export function isNewerVersion(latest, current) {
  return compareVersions(latest, current) > 0;
}

/**
 * 从 release 的 assets 里挑 APK。
 * 优先精确命中构建产物名（历史上唯一产物），否则退化为「第一个 .apk」，都没有则 null。
 */
export function pickApkAsset(assets, preferredName = 'weknora-mobile-webview.apk') {
  if (!Array.isArray(assets) || assets.length === 0) return null;
  const byName = (n) => assets.find((a) => a && typeof a.name === 'string'
    && a.name.toLowerCase() === String(n).toLowerCase());
  const exact = byName(preferredName) || byName('app-release.apk');
  if (exact) return exact;
  return assets.find((a) => a && typeof a.name === 'string' && /\.apk$/i.test(a.name)) || null;
}

/**
 * 把 GitHub 的 release JSON 规整成应用要用的形状。
 * 缺关键字段（tag 或 APK 资产）时返回 null —— 宁可当作「没有可用更新」，
 * 也不要在界面上给出一个点不动的更新按钮。
 */
export function normalizeRelease(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const tag = typeof raw.tag_name === 'string' ? raw.tag_name.trim() : '';
  if (!tag) return null;
  const asset = pickApkAsset(raw.assets);
  if (!asset || !asset.browser_download_url) return null;
  return {
    tag,
    version: tag.replace(/^[vV]/, ''),
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : tag,
    notes: typeof raw.body === 'string' ? raw.body : '',
    publishedAt: raw.published_at || '',
    releaseUrl: typeof raw.html_url === 'string' && raw.html_url
      ? raw.html_url
      : RELEASES_PAGE,
    apkUrl: asset.browser_download_url,
    apkName: asset.name,
    apkSize: typeof asset.size === 'number' ? asset.size : 0,
    prerelease: Boolean(raw.prerelease),
    draft: Boolean(raw.draft)
  };
}

/**
 * 决策入口：给定 release（原始 JSON 或已规整对象）与当前版本，返回结论。
 * @returns {{status: 'update'|'latest'|'invalid', release?: object, current?: string}}
 */
export function evaluateUpdate(rawRelease, currentVersion) {
  const release = rawRelease && rawRelease.apkUrl ? rawRelease : normalizeRelease(rawRelease);
  if (!release) return { status: 'invalid' };
  // 草稿/预发布不作为自动更新目标（仓库若用了会误推给全部用户）
  if (release.draft || release.prerelease) return { status: 'latest' };
  if (!isNewerVersion(release.version, currentVersion)) return { status: 'latest' };
  return { status: 'update', release, current: parseVersion(currentVersion) ? String(currentVersion) : '0.0.0' };
}

/** 取更新说明的前若干行用于弹窗展示（去掉空行与 markdown 分隔线） */
export function releaseNotesPreview(notes, maxLines = 8) {
  if (!notes || typeof notes !== 'string') return '';
  const lines = notes
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^-{3,}$/.test(l) && !/^<!--/.test(l));
  return lines.slice(0, maxLines).join('\n');
}

/** 人类可读体积 */
export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n <= 0) return '';
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

// ---- 检查频率控制（避免每次冷启动都打一次 API，公开接口按 IP 限流）----
const CACHE_KEY = 'weknora_update_cache_v1';
const SKIP_KEY = 'weknora_update_skip_v1';
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 小时

export function readCache(now = Date.now()) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!parsed.at || now - parsed.at > CHECK_INTERVAL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCache(release, now = Date.now()) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: now, release }));
  } catch {
    // 存储不可用（隐私模式等）→ 退化为每次都查，不影响功能
  }
}

export function getSkippedVersion() {
  try {
    return localStorage.getItem(SKIP_KEY) || '';
  } catch {
    return '';
  }
}

export function setSkippedVersion(version) {
  try {
    localStorage.setItem(SKIP_KEY, version || '');
  } catch {
    // 同上
  }
}
