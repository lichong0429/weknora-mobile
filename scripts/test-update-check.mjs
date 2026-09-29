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
  normalizeRelease, evaluateUpdate, releaseNotesPreview, formatBytes
} from '../src/utils/updateChecker.js';

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

console.log();
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`全部通过（${pass} 项）`);
