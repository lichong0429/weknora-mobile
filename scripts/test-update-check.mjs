/**
 * 检查更新逻辑的回归测试（纯函数，不联网）。
 *
 * 锁死的目标：
 *   - 版本比较必须逐段数值比较，不能按字符串比（否则 1.10.0 会被判成小于 1.9.0）
 *   - 没有 APK 资产的 release 必须判为「不可用」，绝不给用户一个点不动的更新按钮
 *   - 草稿 / 预发布不得作为自动更新目标
 *   - 更新说明的截取要丢掉空行与分隔线，避免弹窗里一片空白
 */
import {
  parseVersion, compareVersions, isNewerVersion, pickApkAsset,
  normalizeRelease, evaluateUpdate, releaseNotesPreview, formatBytes,
  readCache, writeCache, planCheckOutcome
} from '../src/utils/updateChecker.js';
import { describeCheckFailure, isRateLimitReason } from '../src/utils/updateMessages.js';
import { translate } from '../src/i18n/index.js';

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function checkTrue(name, cond, detail = '') {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

// ---------------- 1) 版本解析 ----------------
check('v 前缀', parseVersion('v1.7.5'), [1, 7, 5]);
check('无前缀', parseVersion('1.7.5'), [1, 7, 5]);
check('两段', parseVersion('1.7'), [1, 7, 0]);
check('一段', parseVersion('2'), [2, 0, 0]);
check('带后缀', parseVersion('1.7.5-beta.1'), [1, 7, 5]);
check('大写 V', parseVersion('V1.2.3'), [1, 2, 3]);
check('空值', parseVersion(''), null);
check('null', parseVersion(null), null);
check('非版本串', parseVersion('latest'), null);

// ---------------- 2) 版本比较（重点：数值比较，不是字符串比较）----------------
check('同版本', compareVersions('1.7.5', 'v1.7.5'), 0);
check('新版更大', compareVersions('1.7.6', '1.7.5'), 1);
check('旧版更小', compareVersions('1.6.9', '1.7.0'), -1);
checkTrue('1.10.0 > 1.9.0（不能按字符串比）', compareVersions('1.10.0', '1.9.0') === 1,
  `得到 ${compareVersions('1.10.0', '1.9.0')}`);
check('补位相等', compareVersions('1.7', '1.7.0'), 0);
check('段数不同', compareVersions('2.0', '1.99.99'), 1);
check('无法解析按 0 处理', compareVersions('bad', '1.0.0'), -1);
checkTrue('isNewerVersion 真', isNewerVersion('1.8.0', '1.7.5'));
checkTrue('isNewerVersion 假（相同）', !isNewerVersion('1.7.5', '1.7.5'));
checkTrue('isNewerVersion 假（更旧）', !isNewerVersion('1.7.4', '1.7.5'));

// ---------------- 3) APK 资产挑选 ----------------
const ASSETS = [
  { name: 'release-notes.md', browser_download_url: 'https://x/a.md', size: 10 },
  { name: 'weknora-mobile-webview.apk', browser_download_url: 'https://x/a.apk', size: 5934708 },
  { name: 'other.apk', browser_download_url: 'https://x/b.apk', size: 1 }
];
check('优先精确命中构建产物', pickApkAsset(ASSETS).name, 'weknora-mobile-webview.apk');
check('退化为第一个 apk', pickApkAsset(ASSETS.filter((a) => a.name !== 'weknora-mobile-webview.apk')).name, 'other.apk');
check('大写扩展名也可识别', pickApkAsset([{ name: 'X.APK', browser_download_url: 'u' }]).name, 'X.APK');
check('没有 apk 返回 null', pickApkAsset([{ name: 'a.zip', browser_download_url: 'u' }]), null);
check('空资产返回 null', pickApkAsset([]), null);
check('非数组返回 null', pickApkAsset(null), null);

// ---------------- 4) release 规整 ----------------
const RAW = {
  tag_name: 'v1.8.0',
  name: 'WeKnora Mobile v1.8.0',
  body: '第一行\n\n---\n第二行',
  html_url: 'https://github.com/o/r/releases/tag/v1.8.0',
  published_at: '2026-09-29T00:00:00Z',
  prerelease: false,
  draft: false,
  assets: ASSETS
};
const norm = normalizeRelease(RAW);
check('版本去掉 v', norm.version, '1.8.0');
check('apkUrl 取自资产', norm.apkUrl, 'https://x/a.apk');
check('apkSize 透传', norm.apkSize, 5934708);
check('缺 tag 返回 null', normalizeRelease({ assets: ASSETS }), null);
check('缺 apk 资产返回 null', normalizeRelease({ tag_name: 'v1.8.0', assets: [{ name: 'a.zip', browser_download_url: 'u' }] }), null);
check('null 输入返回 null', normalizeRelease(null), null);

// ---------------- 5) 决策 ----------------
check('有新版 → update', evaluateUpdate(RAW, '1.7.5').status, 'update');
check('同版本 → latest', evaluateUpdate(RAW, '1.8.0').status, 'latest');
check('本地更新 → latest', evaluateUpdate(RAW, '1.9.0').status, 'latest');
check('预发布不作为目标', evaluateUpdate({ ...RAW, prerelease: true, tag_name: 'v9.9.9' }, '1.7.5').status, 'latest');
check('草稿不作为目标', evaluateUpdate({ ...RAW, draft: true, tag_name: 'v9.9.9' }, '1.7.5').status, 'latest');
check('无 APK → invalid', evaluateUpdate({ ...RAW, assets: [] }, '1.7.5').status, 'invalid');
checkTrue('update 时带出 release',
  evaluateUpdate(RAW, '1.7.5').release?.apkUrl === 'https://x/a.apk');
checkTrue('update 时带出当前版本', evaluateUpdate(RAW, '1.7.5').current === '1.7.5');

// ---------------- 6) 更新说明截取 ----------------
check('丢掉空行与分隔线',
  releaseNotesPreview('A\n\n---\n\nB', 8), 'A\nB');
check('限制行数', releaseNotesPreview(['1', '2', '3', '4'].join('\n'), 2), '1\n2');
check('空输入', releaseNotesPreview('', 8), '');
check('null 输入', releaseNotesPreview(null, 8), '');
checkTrue('忽略 HTML 注释行', !releaseNotesPreview('<!-- 发版前请替换 -->\n正文', 8).includes('<!--'));

// ---------------- 7) 体积格式化 ----------------
check('MB', formatBytes(5934708), '5.66 MB');
check('KB', formatBytes(2048), '2 KB');
check('0 返回空串', formatBytes(0), '');
check('负数返回空串', formatBytes(-5), '');

// ---------------- 8) 缓存分档（v1.9.1 修复的核心）----------------
//
// 背景：用户反馈「自动检查更新没反应」。根因是「无更新」也被缓存 6 小时——
// 21:00 打开时无更新 → 21:20 发布新版 → 22:00 再打开仍命中旧缓存不请求。
// 这组用例把该场景钉死，并确认「有更新」仍走长档（避免反复弹窗打扰）。
console.log('\n--- 缓存分档 ---');
{
  // 极简 localStorage 替身
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

  const rel = { tag_name: 'v1.9.0', version: '1.9.0', assets: [{ name: 'a.apk', browser_download_url: 'https://x/a.apk', size: 100 }] };

  // 场景 A：无更新 → 短档（30 分钟）
  writeCache(rel, false, 1000_000);
  checkTrue('A 无更新：30 分钟后缓存过期（必须重新查）', readCache(1000_000 + 31 * 60 * 1000) === null);
  checkTrue('A 无更新：20 分钟时缓存仍有效（防抖）', readCache(1000_000 + 20 * 60 * 1000) !== null);

  // 场景 B：有更新 → 长档（6 小时）
  writeCache(rel, true, 2000_000);
  checkTrue('B 有更新：5 小时后仍有效（不重复弹窗）', readCache(2000_000 + 5 * 3600 * 1000) !== null);
  checkTrue('B 有更新：7 小时后过期', readCache(2000_000 + 7 * 3600 * 1000) === null);

  // 关键回归：用户报的原场景
  // 21:00 查得「无更新」并缓存 → 21:20 发布 v1.9.0 → 22:00 打开
  writeCache(rel, false, 21 * 3600_000);
  checkTrue(
    'C 回归：1 小时后（新版已发布）缓存必须已失效，否则用户看不到更新',
    readCache(22 * 3600_000) === null
  );

  // 旧格式缓存（无 hasUpdate 字段）应按短档处理并可正常读取
  store.set('weknora_update_cache_v1', JSON.stringify({ at: 3000_000, release: rel }));
  checkTrue('D 旧格式缓存仍可读', readCache(3000_000 + 60_000) !== null);
  checkTrue('D 旧格式缓存按短档过期', readCache(3000_000 + 31 * 60 * 1000) === null);

  // 损坏数据
  store.set('weknora_update_cache_v1', 'not-json');
  checkTrue('E 损坏缓存返回 null', readCache(3000_000) === null);
  store.set('weknora_update_cache_v1', JSON.stringify({ release: rel }));
  checkTrue('E 缺 at 字段返回 null', readCache(3000_000) === null);
}

// ---------------- 9) 【v1.9.9 回归】「已是最新」不能被当成失败 ----------------
//
// 事故：evaluateUpdate 在 status==='latest' 时**不返回 release**，于是服务层
//   release = verdict.release || null  →  null → { status:'error', reason:'no-release' }
// 只要已是最新版（最常见情况），每次启动都弹「检查更新失败：未取到发布信息
// （可能触发了匿名接口限流）」。文案也是错的：真限流会抛 HTTP 403，走 unknown 分支。
console.log('\n--- 已是最新 与 失败 的区分（v1.9.9 回归）---');
{
  // 1) tag 与当前版本相同 → latest，且**必须带 release**（本次 bug 的直接回归断言）
  const same = evaluateUpdate(RAW, '1.8.0');
  check('同版本 → latest', same.status, 'latest');
  checkTrue('同版本 → 必须带 release（缺它就会被服务层误判成 error/no-release）',
    Boolean(same.release && same.release.apkUrl));

  // 2) tag 更高且有 APK 资产 → update
  const newer = evaluateUpdate(RAW, '1.7.5');
  check('更高版本 → update', newer.status, 'update');
  checkTrue('更高版本 → 带 release', Boolean(newer.release && newer.release.apkUrl));

  // 3) 无 APK 资产 → 仍为 invalid，且不带 release（修 #1 不能把真异常吞成 latest）
  const noApk = evaluateUpdate({ ...RAW, assets: [] }, '1.7.5');
  check('无 APK → 仍是 invalid', noApk.status, 'invalid');
  check('无 APK → 不带 release', noApk.release, undefined);

  // 4) draft / prerelease → latest 且带 release
  checkTrue('预发布 → latest 且带 release',
    evaluateUpdate({ ...RAW, prerelease: true, tag_name: 'v9.9.9' }, '1.7.5').release?.apkUrl === 'https://x/a.apk');
  checkTrue('草稿 → latest 且带 release',
    evaluateUpdate({ ...RAW, draft: true, tag_name: 'v9.9.9' }, '1.7.5').release?.apkUrl === 'https://x/a.apk');
}

// ---------------- 10) 结论映射（服务层不再自己写 if 链）----------------
//
// 说明：这里断言的是纯函数而不是 updateService 本体 —— updateService 依赖
// appVersion.js（静态 import ../../package.json），Node 直接加载会报
// ERR_IMPORT_ATTRIBUTE_MISSING。把映射抽成 planCheckOutcome 后，
// 「latest 被误判成 error」这条路径就能在 check 里被真正锁住。
console.log('\n--- 结论映射（latest 不得变 error）---');
{
  // 1) 已是最新 → latest（本次 bug 的直接回归断言）
  const latestOutcome = planCheckOutcome(evaluateUpdate(RAW, '1.8.0'));
  check('已是最新 → latest', latestOutcome.status, 'latest');
  check('已是最新 → 不带 reason', latestOutcome.reason, undefined);
  checkTrue('已是最新 → release 透出（供缓存使用）', Boolean(latestOutcome.release?.apkUrl));

  // 2) 有新版本 → update
  const updateOutcome = planCheckOutcome(evaluateUpdate(RAW, '1.7.5'));
  check('有新版本 → update', updateOutcome.status, 'update');
  checkTrue('有新版本 → release 透出', Boolean(updateOutcome.release?.apkUrl));

  // 3) 无 APK → error/invalid（真异常不能被吞成 latest）
  const invalidOutcome = planCheckOutcome(evaluateUpdate({ ...RAW, assets: [] }, '1.7.5'));
  check('无 APK → error', invalidOutcome.status, 'error');
  check('无 APK → reason=invalid', invalidOutcome.reason, 'invalid');

  // 4) draft / prerelease → latest（带 release）
  check('预发布 → latest', planCheckOutcome(evaluateUpdate({ ...RAW, prerelease: true, tag_name: 'v9.9.9' }, '1.7.5')).status, 'latest');
  check('草稿 → latest', planCheckOutcome(evaluateUpdate({ ...RAW, draft: true, tag_name: 'v9.9.9' }, '1.7.5')).status, 'latest');

  // 5) no-release 的语义只能是「evaluator 被改坏」：verdict 声称 latest/update 却没有 release
  check('latest 却缺 release → error/no-release（语义唯一）',
    planCheckOutcome({ status: 'latest' }).reason, 'no-release');
  check('update 却缺 release → error/no-release',
    planCheckOutcome({ status: 'update' }).reason, 'no-release');
  check('空 verdict → error/invalid', planCheckOutcome(null).status, 'error');
}

// ---------------- 11) 失败原因 → 可翻译文案 ----------------
console.log('\n--- 失败原因文案 ---');
{
  check('空原因 → unknown', describeCheckFailure('').key, 'settings.updateFailUnknown');
  check('timeout → 超时文案', describeCheckFailure('timeout').key, 'settings.updateFailTimeout');
  check('invalid → 缺少 APK 文案', describeCheckFailure('invalid').key, 'settings.updateFailInvalid');
  check('no-release → 缺少发布信息文案', describeCheckFailure('no-release').key, 'settings.updateFailNoRelease');
  check('HTTP 403 → 限流文案', describeCheckFailure('HTTP 403').key, 'settings.updateFailRateLimited');
  check('HTTP 429 → 限流文案', describeCheckFailure('HTTP 429').key, 'settings.updateFailRateLimited');
  check('HTTP 500 → 通用 HTTP 文案', describeCheckFailure('HTTP 500').key, 'settings.updateFailHttp');
  check('网络错误 → 网络文案', describeCheckFailure('Failed to fetch').key, 'settings.updateFailNetwork');
  checkTrue('限流判定只认 403/429',
    isRateLimitReason('HTTP 403') && isRateLimitReason('HTTP 429') && !isRateLimitReason('HTTP 500'));

  // 文案更正：no-release 不能再甩锅给「限流」
  const zhNoRelease = translate('zh', 'settings.updateFailNoRelease');
  checkTrue('中文 no-release 文案不再提限流',
    zhNoRelease.includes('没有可用的发布信息') && !zhNoRelease.includes('限流'), zhNoRelease);
  const enNoRelease = translate('en', 'settings.updateFailNoRelease');
  checkTrue('英文 no-release 文案不再提限流',
    /no usable release info/i.test(enNoRelease) && !/rate limit/i.test(enNoRelease), enNoRelease);
  checkTrue('中文限流文案带状态码',
    translate('zh', 'settings.updateFailRateLimited', { status: 'HTTP 403' }).includes('HTTP 403'));
  checkTrue('英文限流文案带状态码',
    translate('en', 'settings.updateFailRateLimited', { status: 'HTTP 429' }).includes('HTTP 429'));
}

console.log();
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`全部通过（${pass} 项）`);
