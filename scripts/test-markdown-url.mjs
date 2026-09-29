/**
 * markdown URL 白名单的回归测试。
 *
 * 锁死的目标（曾经的真实事故）：
 *   react-markdown 默认清洗会把 WeKnora 内部存储协议（local://、resource://、storage://…）
 *   整个置空，图片组件收到空 src → 图片永远显示不出来。典型症状：正文里明明有
 *   ![](local://…/exports/xxx.jpg)，界面就是没有图。
 *
 * 同时必须保证：放行自有协议不等于关闭清洗 —— javascript: / data: / vbscript: 仍要拦。
 */
import { defaultUrlTransform } from 'react-markdown';
import { markdownUrlTransform, isInternalStorageUrl, isAppSchemeUrl } from '../src/utils/markdownUrl.js';

let pass = 0;
const failures = [];
const T = (url) => markdownUrlTransform(url, defaultUrlTransform);

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

// ---------------- 1) 先把 bug 钉住：默认清洗确实会置空 ----------------
check('默认清洗会丢弃 local://（这就是图片不显示的根因）', defaultUrlTransform('local://10000/exports/a.png'), '');
check('默认清洗会丢弃 resource://', defaultUrlTransform('resource://abc'), '');
check('默认清洗会丢弃 storage://', defaultUrlTransform('storage://1/local://x.png'), '');

// ---------------- 2) 放行后的行为 ----------------
const INTERNAL_OK = [
  'local://10000/exports/fig_CPEHMYJA.png',
  'local://10000/exports/56761efe-9c90-414d-bf22-6db26c2708f1_1783263408959371515.jpg',
  'resource://AbC-123_x',
  'storage://589509b5-d6c6-425f-bf01-53b3a0608b41/local://10000/a.png',
  'minio://bucket/key.png',
  'cos://7/a.jpg',
  's3://bucket/k',
  'tos://7/a',
  'oss://7/a',
  'obs://7/a',
  'ks3://7/a',
  'LOCAL://10000/a.png', // 大小写不敏感
];
for (const u of INTERNAL_OK) {
  check(`放行内部引用 ${u.slice(0, 34)}`, T(u), u);
  checkTrue(`isInternalStorageUrl 识别 ${u.slice(0, 24)}`, isInternalStorageUrl(u));
}

const APP_OK = ['cite:kb:1', 'cite:web:2', 'wiki:some-slug', 'wiki:concepts%2Fxxx'];
for (const u of APP_OK) {
  check(`放行自有协议 ${u}`, T(u), u);
  checkTrue(`isAppSchemeUrl 识别 ${u}`, isAppSchemeUrl(u));
}

// ---------------- 3) 正常地址不受影响 ----------------
for (const u of ['https://a.com/x.png', 'http://a.com/x.png', '/files?file_path=x', './rel.png', '#anchor', '../up.png']) {
  check(`正常地址保持 ${u}`, T(u), defaultUrlTransform(u));
}

// ---------------- 4) 危险协议仍必须被拦（放行 ≠ 关闭清洗）----------------
const DANGEROUS = [
  'javascript:alert(1)',
  'JavaScript:alert(1)',
  'data:text/html;base64,PHNjcmlwdD4=',
  'vbscript:msgbox(1)',
  'file:///etc/passwd',
];
for (const u of DANGEROUS) {
  const out = T(u);
  checkTrue(`危险协议被拦 ${u.slice(0, 28)}`, out !== u, `实际返回 ${JSON.stringify(out)}`);
}

// ---------------- 5) 边界：不能误判 ----------------
checkTrue('裸 local: 不算内部引用（需要 //）', !isInternalStorageUrl('local:foo'));
checkTrue('local:// 后面必须非空', !isInternalStorageUrl('local://'));
checkTrue('storage:// 缺 provider 不算', !isInternalStorageUrl('storage://123/foo'));
checkTrue('空串原样返回', T('') === '');
checkTrue('非字符串不炸', markdownUrlTransform(undefined, defaultUrlTransform) === undefined);
checkTrue('http 地址不以内部引用处理', !isInternalStorageUrl('https://a.com/local://x'));

console.log();
if (failures.length) {
  console.log(`未通过 ${failures.length} 项：\n  - ${failures.join('\n  - ')}`);
  process.exit(1);
}
console.log(`全部通过（${pass} 项）`);
