#!/usr/bin/env node
/**
 * i18n 回归测试（纯逻辑，不联网、不需要浏览器）。
 *
 * 锁定的东西：
 *  1. `en` 的键集必须**覆盖** `zh` 的每个键 —— 中文是真源，英文缺键会静默回退成中文，
 *     靠人眼在英文界面里翻是翻不出来的，必须机器守。
 *  2. `en` 里多出来的键只 warn 不 fail（可能是中文侧删了键、英文侧忘了删，属于清洁度问题，
 *     不影响用户看到的内容）。
 *  3. 任何 zh 键在 en 下都不能退化成键名本身（`translate(...) === key` 即视为漏翻）。
 *  4. 三级回退 `dict[lang] ?? zh ?? key` 的三条路径都要能走通。
 *  5. `{n}` 参数替换：单遍、只认给定的键、值里带 `$`/`{}` 也不会被二次解释。
 *  6. 专名保护：zh 值里出现的 WeKnora / API Key / FAQ / Wiki … 在 en 值里必须原样保留。
 *  7. 键名格式：必须是白名单命名空间下的扁平 `ns.key`。
 *  8. 英文值里不得残留中日韩字符与全角标点（这是「英文界面无中文残留」的字典级证据）。
 *
 * 用法：node scripts/test-i18n.mjs
 * 退出码：0 通过 / 1 失败
 */
import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';
import {
  DEFAULT_LANG,
  LANGS,
  LANG_STORAGE_KEY,
  DICTS,
  KEY_PREFIXES,
  resolveLang,
  translate,
  createT
} from '../src/i18n/index.js';
import { PROTECTED_TERMS } from '../src/i18n/terms.js';

let pass = 0;
const failures = [];
const warnings = [];

function check(name, cond, detail = '') {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

function checkEq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function warn(name, detail) {
  warnings.push(name);
  console.log(`WARN  ${name}  ${detail}`);
}

const zhKeys = Object.keys(zh);
const enKeys = Object.keys(en);

console.log('=== 0. 字典规模 ===');
console.log(`zh 条目数：${zhKeys.length}`);
console.log(`en 条目数：${enKeys.length}`);
check('字典非空', zhKeys.length > 0 && enKeys.length > 0, `zh=${zhKeys.length} en=${enKeys.length}`);

// ---------------------------------------------------------------- 1. 键集覆盖
console.log('=== 1. en 必须覆盖 zh 的全部键 ===');
const missingInEn = zhKeys.filter((key) => !Object.prototype.hasOwnProperty.call(en, key));
check(
  'en 覆盖 zh 全部键',
  missingInEn.length === 0,
  missingInEn.length ? `缺失 ${missingInEn.length} 个：\n      ${missingInEn.join('\n      ')}` : ''
);

// ---------------------------------------------------------------- 2. en 多余键
console.log('=== 2. en 不应有 zh 不存在的键（warn） ===');
const extraInEn = enKeys.filter((key) => !Object.prototype.hasOwnProperty.call(zh, key));
if (extraInEn.length) {
  warn('en 存在多余键', `${extraInEn.length} 个：${extraInEn.join(', ')}`);
} else {
  pass += 1;
}

// ------------------------------------------------------- 3. 不允许退化成键名
console.log('=== 3. en 下每个 zh 键都必须有译文（不得等于键名） ===');
const leakedKeys = zhKeys.filter((key) => translate('en', key) === key);
check(
  'en 无漏翻（译文不等于键名）',
  leakedKeys.length === 0,
  leakedKeys.length ? `漏翻 ${leakedKeys.length} 个：${leakedKeys.join(', ')}` : ''
);
// 顺带：真源自己也不该漏（zh 缺键 = 词典缺陷）
const zhLeaked = zhKeys.filter((key) => translate('zh', key) === key);
check('zh 无漏翻', zhLeaked.length === 0, zhLeaked.join(', '));

// ---------------------------------------------------------------- 4. 三级回退
console.log('=== 4. 三级回退 dict[lang] ?? zh ?? key ===');
checkEq('完全不存在的中文键名 → 原样返回', translate('en', '不存在的键'), '不存在的键');
checkEq('完全不存在的中文键名（zh 下） → 原样返回', translate('zh', '不存在的键'), '不存在的键');

// 构造「只有 zh 有」的键：直接给真源字典打补丁，验证 en 下会回退到中文
const ZH_ONLY_KEY = 'home.__testOnlyZhKey';
const ZH_ONLY_VALUE = '仅供测试的中文文案';
DICTS.zh[ZH_ONLY_KEY] = ZH_ONLY_VALUE;
try {
  checkEq('仅 zh 有的键 → en 下回退为中文', translate('en', ZH_ONLY_KEY), ZH_ONLY_VALUE);
} finally {
  delete DICTS.zh[ZH_ONLY_KEY];
}

// 构造「只有 en 有」的键：zh 侧查不到，应暴露键名（而不是空白）
const EN_ONLY_KEY = 'home.__testOnlyEnKey';
DICTS.en[EN_ONLY_KEY] = 'English only';
try {
  checkEq('仅 en 有的键 → zh 下暴露键名', translate('zh', EN_ONLY_KEY), EN_ONLY_KEY);
} finally {
  delete DICTS.en[EN_ONLY_KEY];
}

checkEq('非法语言回退 DEFAULT_LANG', resolveLang('fr'), DEFAULT_LANG);
checkEq('null 语言回退 DEFAULT_LANG', resolveLang(null), DEFAULT_LANG);
checkEq('带地区码的语言取主标签', resolveLang('en-US'), 'en');
checkEq('空字符串回退 DEFAULT_LANG', resolveLang(''), DEFAULT_LANG);
checkEq('DEFAULT_LANG 是 zh', DEFAULT_LANG, 'zh');
checkEq('LANGS 覆盖 zh/en', LANGS.join(','), 'zh,en');
checkEq('存储键名固定', LANG_STORAGE_KEY, 'weknora-mobile-lang');

// ------------------------------------------------------------ 5. 参数替换
console.log('=== 5. {name} 参数替换（单遍） ===');
checkEq('common.count 数字参数', translate('zh', 'common.count', { n: 5 }), '共 5 条');
checkEq('common.count 数字参数（en）', translate('en', 'common.count', { n: 5 }), 'Total: 5');
checkEq(
  'kbDetail.loadedCount 参数',
  translate('zh', 'kbDetail.loadedCount', { n: 7 }),
  '已加载 7 条'
);
checkEq('缺参数时保留占位符原样', translate('zh', 'common.count'), '共 {n} 条');
checkEq('未在 params 中的占位符保持不动', translate('zh', 'common.count', { m: 1 }), '共 {n} 条');
checkEq(
  '参数值里的 $ 不被当作替换语义',
  translate('zh', 'common.count', { n: '$&$1$$' }),
  '共 $&$1$$ 条'
);
checkEq(
  '参数值里的花括号不被二次扫描',
  translate('zh', 'common.count', { n: '{m}' }),
  '共 {m} 条'
);
checkEq('createT 绑定语言', createT('en')('nav.home'), 'Home');
checkEq('createT 支持参数', createT('zh')('common.count', { n: 3 }), '共 3 条');

// ---------------------------------------------------------- 6. 专名保护
console.log('=== 6. 专名保护（zh 有 → en 必须有） ===');
let termPairs = 0;
const termViolations = [];
for (const key of zhKeys) {
  const zhValue = zh[key];
  if (typeof zhValue !== 'string') continue;
  for (const term of PROTECTED_TERMS) {
    if (!zhValue.includes(term)) continue;
    termPairs += 1;
    const enValue = en[key];
    if (typeof enValue !== 'string' || !enValue.includes(term)) {
      termViolations.push(`${key} 缺少专名「${term}」（zh=${zhValue} / en=${enValue}）`);
    }
  }
}
console.log(`检查专名出现次数：${termPairs}`);
check('专名在译文中原样保留', termViolations.length === 0, termViolations.join('\n      '));

// ------------------------------------------------------------ 7. 键名格式
console.log('=== 7. 键名格式（白名单命名空间 + 扁平 ns.key） ===');
const KEY_PATTERN = new RegExp(`^(${KEY_PREFIXES.join('|')})\\.[a-zA-Z0-9_.]+$`);
const badZhKeys = zhKeys.filter((key) => !KEY_PATTERN.test(key));
const badEnKeys = enKeys.filter((key) => !KEY_PATTERN.test(key));
check('zh 键名全部合法', badZhKeys.length === 0, badZhKeys.join(', '));
check('en 键名全部合法', badEnKeys.length === 0, badEnKeys.join(', '));
check('zh 键名无重复', new Set(zhKeys).size === zhKeys.length);
check('en 键名无重复', new Set(enKeys).size === enKeys.length);
const emptyZh = zhKeys.filter((key) => typeof zh[key] !== 'string' || zh[key].trim() === '');
const emptyEn = enKeys.filter((key) => typeof en[key] !== 'string' || en[key].trim() === '');
check('zh 无空值', emptyZh.length === 0, emptyZh.join(', '));
check('en 无空值', emptyEn.length === 0, emptyEn.join(', '));

// ------------------------------------------- 8. 英文值不得残留中日韩字符/全角标点
console.log('=== 8. 英文值无中文残留 ===');
// \u4E00-\u9FFF 汉字；\u3000-\u303F 中文标点（「」。、等）；\uFF00-\uFFEF 全角字符（，：（）！？）
const CJK_RE = /[\u4E00-\u9FFF\u3000-\u303F\uFF00-\uFFEF]/;
const cjkInEn = enKeys.filter((key) => CJK_RE.test(en[key]));
check(
  'en 值不含汉字与全角标点',
  cjkInEn.length === 0,
  cjkInEn.map((k) => `${k}=${en[k]}`).join('\n      ')
);

// ------------------------------------------------------- 附：中英条目顺序一致性
const zhOnlyOrder = zhKeys;
const enSameOrder = enKeys.slice(0, zhOnlyOrder.length);
const orderMismatch = zhOnlyOrder.filter((key, idx) => enSameOrder[idx] !== key);
if (orderMismatch.length) {
  warn('中英条目顺序不一致（只为便于 diff，不 fail）', `${orderMismatch.length} 处`);
} else {
  pass += 1;
}

console.log('');
console.log(
  failures.length
    ? `未通过：${failures.length} 项`
    : `全部通过：i18n 回归测试（${pass} 项，zh ${zhKeys.length} 条 / en ${enKeys.length} 条）`
);
if (warnings.length) console.log(`警告：${warnings.length} 项`);
process.exit(failures.length ? 1 : 0);
