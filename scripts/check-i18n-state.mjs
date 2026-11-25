#!/usr/bin/env node
/**
 * i18n 静态守卫：「把翻译结果存进 state」是切语言后文案不跟着变的根因
 * ---------------------------------------------------------------------------
 * 背景（真实缺陷）：notice / status 一类状态原先存的是
 *   `text: t('login.secureSaved')`   ← t() 在这里**立刻求值**，存进去的是字符串快照
 * 渲染处只是把快照贴出来。于是用户切语言后，屏幕上已挂着的提示仍是旧语言 ——
 * 英文界面里留中文，直接违反「英文模式无中文残留」。
 *
 * 正确写法：state 里存 **key + params**，渲染处再 `t(key, params)`（见 utils/noticeText.js）。
 *
 * ---------------------------------------------------------------------------
 * 为什么是**基线模式**而不是全量阻断
 * ---------------------------------------------------------------------------
 * 首次接入时仓库里有 50+ 处历史写法（Chat 的流式消息、KBDetail 的批量操作提示…）。
 * 若守卫直接全量报错，接入当天就红，只能逼着人"为了变绿"去改流式渲染那种高风险代码 ——
 * 这不是守卫该推动的事。所以：
 *   - `scripts/i18n-state-baseline.json` 记录**接入时已知的债务**（锚点 + 出现次数）；
 *   - 命中基线 → 静默通过（老债不阻断 CI）；
 *   - **基线外的新违规 → 退出码 1**（新代码不许再犯）；
 *   - 基线条目已修好（实际出现次数变少）→ 只提示"可从基线移除"，不报错；
 *   - `--update-baseline` 一键重写基线（修完老债后收窄）。
 * 这样 CI 立刻可用、新代码不再犯、老债有清单可追踪。
 *
 * ---------------------------------------------------------------------------
 * 锚点为什么不用行号
 * ---------------------------------------------------------------------------
 * 行号会随"文件上半部分加了几行"整体漂移，用它做锚点会让基线迅速老化、误报刷屏。
 * 这里用 **`文件 :: 写入调用名 :: t() 的 key` + 出现次数**：
 *   - `src/components/Chat.jsx::setMessages::chat.waiting: 1`
 *   - 行号漂移不影响匹配；同文件同 key 出现多次时用计数表达（基线 2 处、现在 3 处 → 报 1 条新增）。
 * key 不是字符串字面量（如 `t(verdict.key)`）时锚点退化为 `<dynamic>`，仍按计数比对。
 *
 * 豁免：某行出现 `i18n-ok` 注释即跳过（用于确属安全、t() 结果不进 state 的写法），
 * 必须在该行写明理由 —— 豁免是给人看的，不是给规则关闸用的。
 *
 * 用法：
 *   node scripts/check-i18n-state.mjs                  # 检查（只报基线外新增）
 *   node scripts/check-i18n-state.mjs --verbose        # 同时列出被基线覆盖的老债
 *   node scripts/check-i18n-state.mjs --update-baseline # 用当前状态重写基线
 *   node scripts/check-i18n-state.mjs --self-test       # 规则自检（不读磁盘源码）
 *   node scripts/check-i18n-state.mjs --quiet
 * 退出码：0 无新增违规 / 1 有新增违规
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const ARGS = new Set(process.argv.slice(2));
const QUIET = ARGS.has('--quiet');
const SELF_TEST = ARGS.has('--self-test');
const UPDATE_BASELINE = ARGS.has('--update-baseline');
const VERBOSE = ARGS.has('--verbose');

// 扫描根目录 / 基线路径可通过环境变量覆盖：
// 目的是能在临时目录里造"新违规"验证守卫真的会红（守卫自己也需要被验证）
const ROOTS = (process.env.I18N_STATE_ROOTS || 'src').split(',').map((s) => s.trim()).filter(Boolean);
const EXT = new Set(['.jsx', '.js']);
const BASELINE_PATH = process.env.I18N_STATE_BASELINE || 'scripts/i18n-state-baseline.json';

/** 递归收集源文件（跳过 node_modules / 构建产物） */
function collect(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', 'dist', 'dist-webview', 'build', 'coverage'].includes(entry.name)) continue;
      collect(full, out);
    } else if (EXT.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** 统一成正斜杠相对路径，保证 Windows / Linux / CI 生成的基线可互换 */
function normFile(file) {
  return file.split(path.sep).join('/').replace(/^\.\//, '');
}

/**
 * 计算每个 `(` 的配对位置，并给出该括号所属的调用名。
 * 用栈做一次线性扫描即可，不追求完整 JS 解析（这是守卫不是编译器）。
 */
function analyzeCalls(text) {
  const stack = [];
  const callOfOpen = new Map();
  const pairs = new Map();
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '(') {
      let j = i - 1;
      while (j >= 0 && /\s/.test(text[j])) j -= 1;
      const end = j + 1;
      while (j >= 0 && /[\w$]/.test(text[j])) j -= 1;
      callOfOpen.set(i, text.slice(j + 1, end));
      stack.push(i);
    } else if (ch === ')') {
      const open = stack.pop();
      if (open !== undefined) pairs.set(open, i);
    }
  }
  return { callOfOpen, pairs };
}

/** 判定调用名是否属于「写 state」的入口 */
function isStateWriter(name) {
  return /^set[A-Z]/.test(name) || name === 'useState';
}

/** 从 t( ... ) 的实参里取 key：字符串字面量取其值，否则 <dynamic> */
function extractTKey(argText) {
  const m = /^\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/.exec(argText);
  return m ? m[2] : '<dynamic>';
}

/**
 * 找 `${` 后面对应的 `}`（跳过字符串与转义，支持嵌套大括号）。
 * @param {string} text 源码
 * @param {number} braceStart `{` 的下标
 * @returns {number} 配对的 `}` 下标；找不到返回 -1
 */
function findMatchingBrace(text, braceStart) {
  let depth = 0;
  for (let i = braceStart; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') { i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 把注释与字符串字面量的**内容**打码成等长空格，保留所有位置与换行。
 *
 * 为什么必须做：守卫只应该看**代码**。
 *   - 注释里写 `// 这里刻意不存 t(...) 的结果` 会被正则当成真实调用（实测误报过一次）；
 *   - 字符串里的括号 `'a(b'` 会打乱括号配对栈，让"t() 是否在 setState 实参内"判断失准。
 * 打码后长度不变，所以匹配到的下标仍可直接用于在原文里取行号与代码片段。
 *
 * 模板字面量要**分段处理**：`` `\n${t('chat.errorTag')}${x}` `` 里的字面量部分打码，
 * 但 `${...}` 里的**表达式必须保留** —— 那里面可能是真实的 `t()` 落 state。
 * （早期版本把整个模板打码，导致 Chat.jsx 4 处 `content: t()` 被静默漏报，
 *   基线与"只剩 4 处债务"的结论因此都错了。）
 */
function maskCode(text) {
  const out = text.split('');
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) {
      if (out[i] !== '\n') out[i] = ' ';
    }
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '/' && next === '/') {
      let end = text.indexOf('\n', i);
      if (end === -1) end = text.length;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '/' && next === '*') {
      let end = text.indexOf('*/', i + 2);
      end = end === -1 ? text.length : end + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (ch === '`') {
      let segStart = i + 1;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === '`') break;
        if (text[j] === '$' && text[j + 1] === '{') {
          blank(segStart, j);
          const close = findMatchingBrace(text, j + 1);
          if (close === -1) { j = text.length; break; }
          const innerMasked = maskCode(text.slice(j + 2, close));
          for (let k = 0; k < innerMasked.length; k += 1) out[j + 2 + k] = innerMasked[k];
          j = close + 1;
          segStart = j;
          continue;
        }
        j += 1;
      }
      blank(segStart, Math.min(j, text.length));
      i = j + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') { j += 2; continue; }
        if (text[j] === quote) break;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out.join('');
}

/**
 * 在给定文本里找出「t() 出现在 state 写入调用实参内」的位置。
 * 独立成函数是为了让 --self-test 能用内存样本验证规则本身：
 * 守卫最危险的失效方式是「规则写坏后静默全绿」，那时所有人都以为已经安全。
 */
function scanText(text, fileLabel) {
  const masked = maskCode(text);
  const { callOfOpen, pairs } = analyzeCalls(masked);

  const writerSpans = [];
  for (const [openPos, name] of callOfOpen) {
    if (!isStateWriter(name)) continue;
    const closePos = pairs.get(openPos);
    if (closePos === undefined) continue;
    writerSpans.push({ openPos, closePos, name });
  }
  if (writerSpans.length === 0) return [];

  const findings = [];
  const exemptions = [];
  // 只匹配独立的 t( 调用：前面不能是标识符字符、`.`、`$`（排除 set( / format( / obj.t( 之类）
  const re = /(?<![\w$.])t\s*\(/g;
  let m;
  while ((m = re.exec(masked)) !== null) {
    const pos = m.index;
    const enclosing = writerSpans.filter((s) => pos > s.openPos && pos < s.closePos);
    if (enclosing.length === 0) continue;
    const innermost = enclosing.reduce((a, b) =>
      (a.closePos - a.openPos <= b.closePos - b.openPos ? a : b));

    const before = text.slice(0, pos);
    const line = before.split('\n').length;
    const lineStart = before.lastIndexOf('\n') + 1;
    const lineEnd = text.indexOf('\n', pos);
    const lineText = text.slice(lineStart, lineEnd === -1 ? text.length : lineEnd);
    // 豁免必须"看得见"：即使被放过，也要能被列出（见文件头"豁免是给人看的"）。
    // 否则 `// i18n-ok` 就成了绕过守卫的后门，谁加的都查不出来。
    if (/i18n-ok/.test(lineText)) {
      const openParenEx = pos + m[0].length - 1;
      const closeParenEx = pairs.get(openParenEx);
      const argTextEx = closeParenEx === undefined ? '' : text.slice(openParenEx + 1, closeParenEx);
      exemptions.push({
        file: normFile(fileLabel),
        line,
        call: innermost.name,
        tKey: extractTKey(argTextEx),
        reason: lineText.split('i18n-ok').slice(1).join('i18n-ok').replace(/[*-]\/.*$/, '').trim()
      });
      continue;
    }

    // key 从**原文**里取（打码后字符串内容已是空格），下标两边一致
    const openParen = pos + m[0].length - 1;
    const closeParen = pairs.get(openParen);
    const argText = closeParen === undefined ? '' : text.slice(openParen + 1, closeParen);

    findings.push({
      file: normFile(fileLabel),
      line,
      call: innermost.name,
      tKey: extractTKey(argText),
      snippet: lineText.trim().replace(/\s+/g, ' ').slice(0, 140)
    });
  }
  findings.exemptions = exemptions;
  return findings;
}

/** 锚点：文件 :: 写入调用名 :: key（不含行号，见文件头说明） */
function anchorOf(finding) {
  return `${finding.file}::${finding.call}::${finding.tKey}`;
}

/** 把 findings 折叠成「锚点 -> 次数」 */
function toCounts(findings) {
  const counts = new Map();
  for (const f of findings) {
    const key = anchorOf(f);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function loadBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
    if (!raw || typeof raw !== 'object') return { anchors: {}, exemptions: {} };
    return {
      ...raw,
      anchors: typeof raw.anchors === 'object' && raw.anchors ? raw.anchors : {},
      exemptions: typeof raw.exemptions === 'object' && raw.exemptions ? raw.exemptions : {}
    };
  } catch {
    return { anchors: {}, exemptions: {} };
  }
}

// ---------------- 规则自检 ----------------
function selfTest() {
  const positives = [
    ['单行对象字面量', "setNotice({ type: 'info', text: t('a') });"],
    ['跨行格式化写法', "setNotice({\n  type: 'warn',\n  text: t('b')\n});"],
    ['三元两个分支', "setNotice(ok ? { text: t('c') } : { text: t('d') });"],
    ['useState 初始值', "const [label, setLabel] = useState(t('e'));"],
    ['setState 回调内部', "setItems((prev) => [...prev, { label: t('f') }]);"],
    ['直接存字符串', "setError(t('g'));"],
    ['嵌套参数里的 t()', "setStatus({ message: t('h', { d: err.message || t('i') }) });"],
    ['模板字符串里的 t()（曾经被整体打码漏报）', 'setMsg({ content: `\\n${t(\'chat.errorTag\')}${x}` });'],
    ['模板字符串里多个 t()', 'setMsg({ content: `${t(\'a\')} - ${t(\'b\')}` });']
  ];
  const negatives = [
    ['渲染期直接 t()（正确）', 'return <span>{t(\'a\')}</span>;'],
    ['局部变量后渲染（正确）', "const msg = t('a');\nreturn <span>{msg}</span>;"],
    ['不含 t() 的 state 写入', 'setConfig({ savePassword: true });'],
    ['对象方法 t()（不是 i18n）', "setData(obj.t('a'));"],
    ['同类前缀函数名（format）', "const s = format(t('a'));"],
    ['行内豁免注释', "setNotice({ text: t('a') }); // i18n-ok 该处立即消费不落 state"],
    ['注释里提到 t( 不算违规（实测误报过）', "setNotice({ /* 刻意不存 t(...) 结果 */ key: 'a' });"],
    ['字符串字面量里含 t( 不算违规', "setNotice({ text: 'see t(x) docs' });"],
    ['模板字面量里纯文本不含 t（不算违规）', 'setMsg({ content: `plain text only` });'],
    ['动态 key 也按锚点计数', "setNotice(t(someKey));"]
  ];

  let bad = 0;
  let total = 0;
  console.log('--- 规则自检（正样本应命中）---');
  for (const [name, sample] of positives) {
    total += 1;
    const hit = scanText(sample, '<sample>').length > 0;
    if (!hit) bad += 1;
    console.log(`${hit ? 'PASS' : 'FAIL'}  ${name}`);
  }
  console.log('--- 规则自检（反样本不应命中）---');
  // 最后一个反样本是"动态 key"，它**应该**命中（只是 key 记为 <dynamic>），单独验证
  const noHitSamples = negatives.slice(0, -1);
  for (const [name, sample] of noHitSamples) {
    total += 1;
    const hit = scanText(sample, '<sample>').length > 0;
    if (hit) bad += 1;
    console.log(`${hit ? 'FAIL' : 'PASS'}  ${name}`);
  }

  // 字符串里的括号不能破坏括号配对：必须仍能命中后面那处真实调用
  console.log('--- 打码/配对健壮性自检 ---');
  const pairing = scanText("setNotice({ text: 'a(b' }); setError(t('z'));", '<sample>');
  total += 1;
  const pairingOk = pairing.length === 1 && pairing[0].tKey === 'z';
  if (!pairingOk) bad += 1;
  console.log(`${pairingOk ? 'PASS' : 'FAIL'}  字符串里的括号不影响后续 t() 检出`);

  const commentOnly = scanText("setNotice({\n  // 这里刻意不存 t(...) 的结果\n  key: 'a'\n});", '<sample>');
  total += 1;
  const commentOk = commentOnly.length === 0;
  if (!commentOk) bad += 1;
  console.log(`${commentOk ? 'PASS' : 'FAIL'}  注释里的 t( 不被当成调用`);

  // ---- 定位精度：只断言"命中数 > 0"抓不到"分段边界吞掉表达式 / 把一个表达式拆成两半" ----
  // 这是"打码-分段"实现最典型的二次回归，必须断言命中的**是哪些 key**、属于**哪个 setXxx**。
  console.log('--- 定位精度自检（分段不能吞掉或拆碎表达式）---');
  const twoExpr = scanText('setMsg({ content: `${t(\'a\')} — ${t(\'b\')}` });', '<s>');
  total += 1;
  const twoOk = twoExpr.length === 2
    && twoExpr.map((f) => f.tKey).join(',') === 'a,b'
    && twoExpr.every((f) => f.call === 'setMsg');
  if (!twoOk) bad += 1;
  console.log(`${twoOk ? 'PASS' : 'FAIL'}  两个表达式各命中一次且 key/方法名正确（实际 ${JSON.stringify(twoExpr.map((f) => `${f.call}:${f.tKey}`))}）`);

  const threeExpr = scanText('setMsg(`${t(\'a\')}${t(\'b\')}${t(\'c\')}`);', '<s>');
  total += 1;
  const threeOk = threeExpr.length === 3 && threeExpr.map((f) => f.tKey).join(',') === 'a,b,c';
  if (!threeOk) bad += 1;
  console.log(`${threeOk ? 'PASS' : 'FAIL'}  三个连续表达式全部命中（实际 ${JSON.stringify(threeExpr.map((f) => f.tKey))}）`);

  const nestedBrace = scanText('setMsg(`${t(\'a\', { d: { n: 1 } })}`);', '<s>');
  total += 1;
  const nestedBraceOk = nestedBrace.length === 1 && nestedBrace[0].tKey === 'a';
  if (!nestedBraceOk) bad += 1;
  console.log(`${nestedBraceOk ? 'PASS' : 'FAIL'}  表达式内嵌套大括号不打断分段`);

  const afterExpr = scanText('setMsg(`${t(\'a\')}中文尾巴`);', '<s>');
  total += 1;
  const afterExprOk = afterExpr.length === 1 && afterExpr[0].tKey === 'a';
  if (!afterExprOk) bad += 1;
  console.log(`${afterExprOk ? 'PASS' : 'FAIL'}  表达式后面的中文字面量不影响命中`);

  const escapedTick = scanText('setMsg(`a\\`b${t(\'k\')}`);', '<s>');
  total += 1;
  const escapedTickOk = escapedTick.length === 1 && escapedTick[0].tKey === 'k';
  if (!escapedTickOk) bad += 1;
  console.log(`${escapedTickOk ? 'PASS' : 'FAIL'}  模板内转义反引号不影响分段`);

  // 真实事故形态回归：Chat.jsx:356 的那一行（曾被整体打码漏报 2 处）
  // 用真实 key 钉住 —— 将来任何分段改动让这两处再次消失，自检会立刻红。
  const realChat = scanText(
    "setMessages((prev) => [...prev.slice(0, -1), { content: `${t('chat.noAnswerHeading')} —— ${verdict.verdict}\\n\\n${verdict.action}\\n\\n${t('chat.noAnswerHint')}`, diagnosis: verdict }]);",
    '<s>'
  );
  total += 1;
  const realChatOk = realChat.length === 2
    && realChat.map((f) => f.tKey).join(',') === 'chat.noAnswerHeading,chat.noAnswerHint'
    && realChat.every((f) => f.call === 'setMessages');
  if (!realChatOk) bad += 1;
  console.log(`${realChatOk ? 'PASS' : 'FAIL'}  真实事故行（Chat.jsx:356 形态）两处 key 与写入调用名均正确（实际 ${JSON.stringify(realChat.map((f) => `${f.call}:${f.tKey}`))}）`);

  // ---- 基线比对逻辑自检（这部分最容易写错：比错了会让"新违规"静默通过）
  console.log('--- 基线比对自检 ---');
  const dynSample = negatives[negatives.length - 1][1];
  const dynHit = scanText(dynSample, '<sample>');
  total += 1;
  const dynKeyOk = dynHit.length === 1 && dynHit[0].tKey === '<dynamic>';
  if (!dynKeyOk) bad += 1;
  console.log(`${dynKeyOk ? 'PASS' : 'FAIL'}  动态 key 归为 <dynamic>`);

  const countsA = toCounts(scanText("setNotice(t('x'));\nsetNotice(t('x'));", '<a>'));
  const countsB = toCounts(scanText("setNotice(t('x'));", '<a>'));
  const anchor = '<a>::setNotice::x';
  total += 1;
  const sameAnchor = countsA.get(anchor) === 2 && countsB.get(anchor) === 1;
  if (!sameAnchor) bad += 1;
  console.log(`${sameAnchor ? 'PASS' : 'FAIL'}  同 key 多次出现按计数区分`);

  const diff = diffWithBaseline(countsA, { [anchor]: 1 });
  total += 1;
  const detected = diff.added.length === 1 && diff.added[0].excess === 1;
  if (!detected) bad += 1;
  console.log(`${detected ? 'PASS' : 'FAIL'}  比基线多 1 处 → 报 1 条新增`);

  const covered = diffWithBaseline(countsB, { [anchor]: 1 });
  total += 1;
  const silent = covered.added.length === 0;
  if (!silent) bad += 1;
  console.log(`${silent ? 'PASS' : 'FAIL'}  与基线相等 → 不报`);

  total += 1;
  const stale = diffWithBaseline(countsB, { [anchor]: 2 }).stale.length === 1;
  if (!stale) bad += 1;
  console.log(`${stale ? 'PASS' : 'FAIL'}  基线多出（已修好）→ 只提示不报错`);

  const newFile = diffWithBaseline(toCounts(scanText("setError(t('n'));", '<b>')), { [anchor]: 1 });
  total += 1;
  const newFileReported = newFile.added.length === 1;
  if (!newFileReported) bad += 1;
  console.log(`${newFileReported ? 'PASS' : 'FAIL'}  基线外新文件 → 报新增`);

  // 豁免走同一条比对逻辑：新增豁免必须能被识别（否则 `// i18n-ok` 就是后门）
  const exScan = scanText("setNotice({ text: t('a') }); // i18n-ok 已渲染期翻译", '<a>');
  total += 1;
  const exParsed = exScan.length === 0
    && (exScan.exemptions || []).length === 1
    && exScan.exemptions[0].tKey === 'a'
    && exScan.exemptions[0].reason.includes('已渲染期翻译');
  if (!exParsed) bad += 1;
  console.log(`${exParsed ? 'PASS' : 'FAIL'}  豁免被记录（含 key 与理由），不计入违规`);

  const exDiff = diffWithBaseline(toCounts(exScan.exemptions || []), {});
  total += 1;
  const exAdded = exDiff.added.length === 1;
  if (!exAdded) bad += 1;
  console.log(`${exAdded ? 'PASS' : 'FAIL'}  新增豁免（基线里没有）→ 报新增`);

  const exCovered = diffWithBaseline(toCounts(exScan.exemptions || []), { '<a>::setNotice::a': 1 });
  total += 1;
  const exSilent = exCovered.added.length === 0;
  if (!exSilent) bad += 1;
  console.log(`${exSilent ? 'PASS' : 'FAIL'}  豁免已在基线里 → 不报`);

  console.log(bad ? `\n自检未通过：${bad} 项` : `\n自检全部通过（${total} 项）`);
  return bad;
}

/** 用「当前计数」对比「基线计数」 */
function diffWithBaseline(currentCounts, baselineAnchors) {
  const added = [];
  const stale = [];
  const baseline = new Map(Object.entries(baselineAnchors || {}).map(([k, v]) => [k, Number(v) || 0]));
  for (const [anchor, count] of currentCounts) {
    const allowed = baseline.get(anchor) || 0;
    if (count > allowed) added.push({ anchor, excess: count - allowed, total: count, allowed });
  }
  for (const [anchor, allowed] of baseline) {
    const count = currentCounts.get(anchor) || 0;
    if (count < allowed) stale.push({ anchor, allowed, actual: count });
  }
  return { added, stale };
}

if (SELF_TEST) {
  process.exit(selfTest() ? 1 : 0);
}

// ---------------- 主流程 ----------------
const files = ROOTS.flatMap((root) => collect(root));
const perFileFindings = files.map((file) => scanText(fs.readFileSync(file, 'utf8'), file));
const findings = perFileFindings.flat();
const exemptions = perFileFindings.flatMap((list) => list.exemptions || []);
const counts = toCounts(findings);

if (UPDATE_BASELINE) {
  const anchors = {};
  for (const [anchor, count] of [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    anchors[anchor] = count;
  }
  const exemptionAnchors = {};
  const exCounts = toCounts(exemptions);
  for (const [anchor, count] of [...exCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    exemptionAnchors[anchor] = count;
  }
  const payload = {
    note: '已知历史债务基线：锚点 = 文件 :: 写入调用名 :: t() 的 key（不含行号，行号漂移不影响）。修完后用 --update-baseline 收窄。',
    generatedAt: new Date().toISOString().slice(0, 10),
    anchors,
    exemptions: exemptionAnchors
  };
  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`已写入基线：${BASELINE_PATH}（${counts.size} 个锚点 / ${findings.length} 处；豁免 ${exemptions.length} 处）`);
  process.exit(0);
}

const baseline = loadBaseline();
const { added, stale } = diffWithBaseline(counts, baseline.anchors);
// 豁免也走基线：**新增豁免 = 违规**。
// 理由：`// i18n-ok` 是绕过守卫的唯一通道。若允许随手新增，等于守卫可以被"一行注释"关掉；
// 要走豁免就必须改 baseline.json（改基线的动作在 diff 里可见，得有人 review）。
const exemptionDiff = diffWithBaseline(toCounts(exemptions), baseline.exemptions);
const baselineTotal = Object.values(baseline.anchors).reduce((a, b) => a + (Number(b) || 0), 0);

if (!QUIET) {
  console.log(`i18n 静态守卫：扫描 ${files.length} 个源文件，命中 ${findings.length} 处` +
    `（基线内 ${Math.min(findings.length, baselineTotal)} 处，锚点 ${Object.keys(baseline.anchors).length} 个）`);
  // 豁免必须始终可见：`// i18n-ok` 是绕过守卫的通道，不能悄悄生效
  if (exemptions.length === 0) {
    console.log('i18n-ok 豁免：0 处');
  } else {
    console.log(`i18n-ok 豁免：${exemptions.length} 处（绕过守卫的写法，请逐条确认真属安全）`);
    for (const ex of exemptions) console.log(`  ⚑ ${ex.file}:${ex.line}${ex.reason ? `  ${ex.reason}` : ''}`);
  }
}

if (VERBOSE && findings.length > 0) {
  console.log('\n被基线覆盖的历史债务（不阻断）：');
  for (const f of findings) {
    const anchor = anchorOf(f);
    if (baseline.anchors[anchor]) {
      console.log(`  ○ ${f.file}:${f.line}  [${f.call}]  ${f.tKey}`);
    }
  }
  if (baseline.todo) {
    console.log('\n后续批次待处理文件：');
    for (const [file, why] of Object.entries(baseline.todo)) console.log(`  · ${file} — ${why}`);
  }
}

if (stale.length > 0 && !QUIET) {
  console.log('\n基线可收窄（这些老债已修好，可执行 --update-baseline 移除）：');
  for (const s of stale) console.log(`  ✓ ${s.anchor}（基线 ${s.allowed} → 现在 ${s.actual}）`);
}

if (added.length === 0 && exemptionDiff.added.length === 0) {
  console.log('结果：通过（没有基线外的新违规，也没有新增豁免）');
  process.exit(0);
}

if (exemptionDiff.added.length > 0) {
  console.log('\n新增豁免（等于绕过守卫，必须逐条说明理由并由人 review）：');
  for (const item of exemptionDiff.added) {
    for (const ex of exemptions.filter((e) => anchorOf(e) === item.anchor)) {
      console.log(`  ⚑ ${ex.file}:${ex.line}  [${ex.call}]  key=${ex.tKey}`);
      console.log(`       理由：${ex.reason || '（未写明理由 —— 必须补）'}`);
    }
  }
  console.log('       正确做法是改成 key+params；确属安全用法才允许豁免，且要改 i18n-state-baseline.json。');
}

if (added.length > 0) {
  console.log('\n新增违规（基线之外的 t() 落 state —— 切语言后文案不会跟着变）：');
  for (const item of added) {
    const [file, call, key] = item.anchor.split('::');
    const hits = findings.filter((f) => anchorOf(f) === item.anchor);
    for (const f of hits) {
      console.log(`  ⛔ ${f.file}:${f.line}  [${f.call}]  key=${f.tKey}`);
      console.log(`       ${f.snippet}`);
    }
    console.log(`       （基线允许 ${item.allowed} 处，当前 ${item.total} 处，超出 ${item.excess} 处）`);
    if (key === '<dynamic>') console.log(`       （动态 key：${call} 内出现 t(变量)，无法静态判断内容）`);
    if (file) { /* 保留变量以便调试时打印 */ }
  }
  console.log('\n修法：state 存 { key, params }，渲染处用 utils/noticeText.js 的 noticeText(notice, t)。');
}

console.log(`\n汇总：新增违规 ${added.length} 个锚点 / 新增豁免 ${exemptionDiff.added.length} 个锚点 / 基线内 ${baselineTotal} 处`);
process.exit(1);
