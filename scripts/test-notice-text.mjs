#!/usr/bin/env node
/**
 * 提示语渲染器 `noticeText()` 回归测试（纯逻辑，不联网、不依赖 React）。
 *
 * 被测对象：`src/utils/noticeText.js`（纯 JS，Node 可直接 import）。
 *
 * 这份测试守的是「切语言后提示语会跟着变」这件**功能本身**：
 * 之前组件把 `t('…')` 的结果存进 state，等于给文案拍了张快照 ——
 * 用户切到英文后，屏幕上那条提示仍是中文。修法是 state 只存 key + params，
 * 渲染时再翻译；`noticeText()` 就是这个渲染器。
 *
 * 除了常规渲染，重点钉住三类容易回退的语义：
 *   1. **服务端原文不进词典**（`raw` 优先于 `key`）—— 翻译服务端文本只会得到
 *      「未翻译的 {detail}」这种更难看的结果；
 *   2. **`fallbacks` 只补"真的没有值"**——`false` / `0` 是合法参数，
 *      被当成空值补掉会输出错文案，且这种 bug 只在特定数据下出现；
 *   3. **`appendTo` 只允许一层**——出现两层说明结构该换成数组了，
 *      静默拼接会让提示语变成一段无法维护的长字符串。
 *
 * 用法：node scripts/test-notice-text.mjs
 * 退出码：0 通过 / 1 失败
 */
import { noticeText } from '../src/utils/noticeText.js';
import { createT } from '../src/i18n/index.js';

/**
 * appendTo 嵌套两层时的契约 —— **代码改了就改这一行**。
 *
 * 现状（磁盘上的实现）：fail-soft，dev 下 console.warn 并忽略更深层，不抛错。
 * 但 lead 已裁定要改成"直接抛错"（理由：只在结构性误用下触发，属开发期绊线）。
 * 两边结论不同，所以这里把契约显式写成一个开关：
 *   - 现在为 false（跟随磁盘实现，保证 CI 与代码一致）
 *   - A 落码改成抛错后，这里改 true，三条断言自动跟随
 * 故意不写成"抛错或不抛都算通过"——那样等于没有断言。
 */
const NESTED_APPEND_THROWS = false;

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

/** 安全调用：实现抛错时返回 fallback，让断言以 FAIL 出现而不是中断整个测试 */
function safe(fn, fallback = '') {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// ---------------- 测试用的 t：中英两套词典 ----------------
// 刻意做成"同一 key 两种语言"，才能验证切换语言后渲染结果确实变了。
const DICT = {
  zh: {
    'login.secureSaved': '密码已加密保存在本机',
    'login.secureOtherServer': '本机保存的密码属于 {host}，与当前服务器不同',
    'login.clearFailed': '清除失败：{detail}',
    'common.unknownError': '未知错误',
    'settings.testFailed': '测试失败',
    'chat.waiting': '正在思考…'
  },
  en: {
    'login.secureSaved': 'Password is saved on this device (encrypted)',
    'login.secureOtherServer': 'The saved password belongs to {host}, which differs from the current server',
    'login.clearFailed': 'Clear failed: {detail}',
    'common.unknownError': 'Unknown error',
    'settings.testFailed': 'Test failed',
    'chat.waiting': 'Thinking…'
  }
};

/** 造一个 useI18n 的 t：支持 {name} 插值，缺键时回退成键名（与真实实现同语义） */
function makeT(lang) {
  return (key, params) => {
    const template = DICT[lang][key];
    if (template === undefined) return key;
    if (!params || typeof params !== 'object') return template;
    return template.replace(/\{(\w+)\}/g, (whole, name) =>
      (params[name] === undefined || params[name] === null ? whole : String(params[name])));
  };
}
const tZh = makeT('zh');
const tEn = makeT('en');

// =====================================================================
// 0) 用**真实词典**验证核心目标：同一个 notice 换语言就换文案
//
// 这一节是本次修复的核心证据，SSR / 人眼看截图都验不到它：
// 原 bug 的形态是 `setXxx({ text: t('…') })` —— t() 在赋值时求值一次，
// 之后不管 `lang` 怎么变，state 里那串字符串都不会再变。
// 现在 state 只存 key，渲染期才调 t，所以同一对象在 zh / en 下必须给出不同文案。
// =====================================================================
const realZh = createT('zh');
const realEn = createT('en');

// 元断言：本节用到的所有 key 必须真的存在于词典。
// 否则 `t()` 会回退成键名，而"两种语言输出不同"这类断言反而会**假通过**。
const usedKeys = [
  'login.secureOtherServer', 'login.secureSaved', 'login.errLoginFailed',
  'common.unknownError', 'settings.testFailed', 'login.testNoAccountApi', 'login.testOk'
];
for (const key of usedKeys) {
  checkTrue(`词典键存在（不是回退成键名）：${key}`, realZh(key) !== key && realEn(key) !== key, `zh=${realZh(key)} en=${realEn(key)}`);
}

const realNotice = { type: 'warn', key: 'login.secureOtherServer', params: { host: 'a.example.com' } };
const realZhText = noticeText(realNotice, realZh);
const realEnText = noticeText(realNotice, realEn);
checkTrue(
  '核心：同一 notice 换 createT(\'zh\') / createT(\'en\') 输出不同语言',
  realZhText !== realEnText,
  `zh=${realZhText} / en=${realEnText}`
);
checkTrue('核心：中英两版都带上 params.host', realZhText.includes('a.example.com') && realEnText.includes('a.example.com'), `zh=${realZhText} / en=${realEnText}`);
checkTrue('核心：中文版含中文关键词', realZhText.includes('与当前服务器不同'), realZhText);
checkTrue('核心：英文版不含该中文片段（无中文残留）', !realEnText.includes('与当前服务器不同'), realEnText);

// 同一份 notice 连续渲染两次必须稳定（渲染器不能自己累积状态）
check('核心：同一对象重复渲染结果稳定', noticeText(realNotice, realZh), realZhText);

// 服务端原文在真实词典下也原样保留（不进词典）
check('真实词典：raw 原样输出（en）', noticeText({ raw: '服务器炸了' }, realEn), '服务器炸了');
check('真实词典：raw 优先于 key', noticeText({ raw: 'RAW', key: 'login.secureSaved' }, realEn), 'RAW');
check(
  '真实词典：raw 为空 → 回落 fallbackKey',
  noticeText({ raw: '', fallbackKey: 'settings.testFailed' }, realEn),
  realEn('settings.testFailed')
);
checkTrue(
  '真实词典：fallbacks 用译文补齐空 detail',
  noticeText({ key: 'login.errLoginFailed', params: { detail: '' }, fallbacks: { detail: 'common.unknownError' } }, realZh)
    .includes(realZh('common.unknownError')),
  noticeText({ key: 'login.errLoginFailed', params: { detail: '' }, fallbacks: { detail: 'common.unknownError' } }, realZh)
);
checkTrue(
  '真实词典：detail 有值时不覆盖（服务端原文保留）',
  noticeText({ key: 'login.errLoginFailed', params: { detail: '账号被锁' }, fallbacks: { detail: 'common.unknownError' } }, realZh)
    .includes('账号被锁'),
  noticeText({ key: 'login.errLoginFailed', params: { detail: '账号被锁' }, fallbacks: { detail: 'common.unknownError' } }, realZh)
);
check(
  '真实词典：appendTo 两行',
  noticeText({ key: 'login.testNoAccountApi', appendTo: { key: 'login.testOk', params: { ms: 12 } } }, realEn).split('\n').length,
  2
);

// =====================================================================
// 1) key + params 基本渲染（用自建小词典，便于精确比对与制造边界值）
// =====================================================================
check('key 渲染（中）', noticeText({ type: 'info', key: 'login.secureSaved' }, tZh), '密码已加密保存在本机');
check(
  'key + params 插值',
  noticeText({ type: 'warn', key: 'login.secureOtherServer', params: { host: 'a.example.com' } }, tZh),
  '本机保存的密码属于 a.example.com，与当前服务器不同'
);

// 这份改动的目的本身就是"切语言后跟着变"，所以这条必须有：
checkTrue(
  '同一 notice 在两种语言下渲染出不同文本',
  noticeText({ key: 'login.secureSaved' }, tZh) !== noticeText({ key: 'login.secureSaved' }, tEn),
  `zh=${noticeText({ key: 'login.secureSaved' }, tZh)} / en=${noticeText({ key: 'login.secureSaved' }, tEn)}`
);
check(
  '英文渲染（无中文残留）',
  noticeText({ key: 'login.secureSaved' }, tEn),
  'Password is saved on this device (encrypted)'
);

// =====================================================================
// 2) fallbacks：只补"真的没有值"
// =====================================================================
check(
  'fallbacks：params.detail 有值时不覆盖',
  noticeText({ key: 'login.clearFailed', params: { detail: 'HTTP 500' }, fallbacks: { detail: 'common.unknownError' } }, tZh),
  '清除失败：HTTP 500'
);
check(
  'fallbacks：detail 为空串时用译文兜底',
  noticeText({ key: 'login.clearFailed', params: { detail: '' }, fallbacks: { detail: 'common.unknownError' } }, tZh),
  '清除失败：未知错误'
);
check(
  'fallbacks：detail 缺失时用译文兜底',
  noticeText({ key: 'login.clearFailed', fallbacks: { detail: 'common.unknownError' } }, tZh),
  '清除失败：未知错误'
);
check(
  'fallbacks：detail 为 null 时兜底',
  noticeText({ key: 'login.clearFailed', params: { detail: null }, fallbacks: { detail: 'common.unknownError' } }, tZh),
  '清除失败：未知错误'
);
// false / 0 是合法参数值 —— 被当成空值补掉会输出错文案，且只在特定数据下复现
check(
  'fallbacks：detail 为 0 不被兜底',
  noticeText({ key: 'login.clearFailed', params: { detail: 0 }, fallbacks: { detail: 'common.unknownError' } }, tZh),
  '清除失败：0'
);
check(
  'fallbacks：detail 为 false 不被兜底',
  noticeText({ key: 'login.clearFailed', params: { detail: false }, fallbacks: { detail: 'common.unknownError' } }, tZh),
  '清除失败：false'
);
// 兜底译文本身也要跟随语言
check(
  'fallbacks：兜底文案跟随语言',
  noticeText({ key: 'login.clearFailed', params: { detail: '' }, fallbacks: { detail: 'common.unknownError' } }, tEn),
  'Clear failed: Unknown error'
);
// 不修改入参对象（resolveParams 里做了展开，防止调用方 state 被偷偷改）
const frozenParams = { detail: '' };
noticeText({ key: 'login.clearFailed', params: frozenParams, fallbacks: { detail: 'common.unknownError' } }, tZh);
check('fallbacks：不污染调用方的 params 对象', frozenParams, { detail: '' });

// =====================================================================
// 3) 服务端原文 raw 优先，且不进词典
// =====================================================================
check(
  'raw 优先于 key（服务端原文原样显示）',
  noticeText({ raw: 'HTTP 502 Bad Gateway', key: 'settings.testFailed' }, tZh),
  'HTTP 502 Bad Gateway'
);
check(
  'raw 为空串时回落到 key',
  noticeText({ raw: '', key: 'settings.testFailed' }, tZh),
  '测试失败'
);
check(
  'raw 缺失时回落到 fallbackKey',
  noticeText({ fallbackKey: 'settings.testFailed' }, tZh),
  '测试失败'
);
check(
  'raw 优先于 fallbackKey',
  noticeText({ raw: 'connection reset', fallbackKey: 'settings.testFailed' }, tZh),
  'connection reset'
);
check(
  'raw 在英文环境下也原样显示（不被翻译）',
  noticeText({ raw: '已达到 Token Plan 用量上限 (2056)' }, tEn),
  '已达到 Token Plan 用量上限 (2056)'
);

// =====================================================================
// 4) appendTo：只一层，两段各自跟随语言
// =====================================================================
const appended = noticeText({
  key: 'chat.waiting',
  appendTo: { key: 'login.secureSaved' }
}, tZh);
check('appendTo：两段用换行拼接', appended, '密码已加密保存在本机\n正在思考…');
checkTrue('appendTo：结果含换行', appended.includes('\n'), appended);
check(
  'appendTo：两段同时切语言',
  noticeText({ key: 'chat.waiting', appendTo: { key: 'login.secureSaved' } }, tEn),
  'Password is saved on this device (encrypted)\nThinking…'
);
check(
  'appendTo：上一段为空时不留空行',
  noticeText({ key: 'chat.waiting', appendTo: {} }, tZh),
  '正在思考…'
);
check(
  'appendTo：当前段为空时只留上一段',
  noticeText({ appendTo: { key: 'login.secureSaved' } }, tZh),
  '密码已加密保存在本机'
);
check(
  'appendTo：两段都为空 → 空串',
  noticeText({ appendTo: {} }, tZh),
  ''
);

// 两层嵌套属于结构性误用（该改用数组了）。契约见文件头的 NESTED_APPEND_THROWS 开关。
let nestedThrew = null;
let nestedOut = '';
try {
  nestedOut = noticeText({
    key: 'chat.waiting',
    appendTo: { key: 'login.secureSaved', appendTo: { key: 'common.unknownError' } }
  }, tZh);
} catch (err) {
  nestedThrew = err;
}
if (NESTED_APPEND_THROWS) {
  checkTrue('appendTo：两层嵌套抛错（开发期绊线）', nestedThrew instanceof Error, `实际 ${nestedThrew}`);
} else {
  check('appendTo：两层嵌套不抛错（fail-soft，渲染期不白屏）', nestedThrew, null);
  check('appendTo：两层嵌套只渲染一层，深层被忽略', nestedOut, '密码已加密保存在本机\n正在思考…');
  checkTrue('appendTo：深层文案不出现', !nestedOut.includes('未知错误'), nestedOut);
}

// =====================================================================
// 5) 空值与容错：渲染期永远不能崩
// =====================================================================
check('notice 为 null → 空串', noticeText(null, tZh), '');
check('notice 为 undefined → 空串', noticeText(undefined, tZh), '');
check('notice 为空对象 → 空串', noticeText({}, tZh), '');
check('notice 为字符串（误用）→ 空串', noticeText('oops', tZh), '');
check('key 为空串 → 空串', noticeText({ key: '' }, tZh), '');
// t 缺失/非函数时退化为返回键名，保证渲染期不因漏传 t 而白屏
check('t 缺失 → 返回键名而不崩', noticeText({ key: 'login.secureSaved' }, undefined), 'login.secureSaved');
check('t 非函数 → 返回键名而不崩', noticeText({ key: 'login.secureSaved' }, {}), 'login.secureSaved');
check('未知 key → 回退为键名', noticeText({ key: 'no.such.key' }, tZh), 'no.such.key');

// 各种垃圾 notice 都不得抛
const garbage = [0, 1, NaN, false, true, [], [1, 2], { key: 123 }, { params: 'x', key: 'login.secureSaved' }];
for (const value of garbage) {
  let threw = null;
  let out = null;
  try {
    out = noticeText(value, tZh);
  } catch (err) {
    threw = err;
  }
  check(`不抛（noticeText(${JSON.stringify(value)})）`, threw, null);
  checkTrue(`不抛（noticeText(${JSON.stringify(value)})）返回字符串`, typeof out === 'string', `实际 ${typeof out}`);
}

// =====================================================================
// 6) 真实场景端到端：跨服务器提示 + 服务端错误明细
// =====================================================================
const crossServerNotice = {
  type: 'warn',
  key: 'login.secureOtherServer',
  params: { host: 'a.example.com:8080' }
};
check(
  '场景：跨服务器提示（中）',
  noticeText(crossServerNotice, tZh),
  '本机保存的密码属于 a.example.com:8080，与当前服务器不同'
);
check(
  '场景：跨服务器提示（英）',
  noticeText(crossServerNotice, tEn),
  'The saved password belongs to a.example.com:8080, which differs from the current server'
);
check(
  '场景：保存失败带服务端/异常明细',
  noticeText({
    type: 'error',
    key: 'login.clearFailed',
    params: { detail: 'Keystore unavailable' },
    fallbacks: { detail: 'common.unknownError' }
  }, tEn),
  'Clear failed: Keystore unavailable'
);
check(
  '场景：保存失败无明细时用译文兜底（不改语言也一致）',
  safe(() => noticeText({ type: 'error', key: 'login.clearFailed', params: {}, fallbacks: { detail: 'common.unknownError' } }, tZh)),
  '清除失败：未知错误'
);

console.log(
  failures.length
    ? `\n未通过：${failures.length} 项`
    : `\n全部通过：提示语渲染回归测试（${pass} 项）`
);
process.exit(failures.length ? 1 : 0);
