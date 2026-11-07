/**
 * 问答正文里的数学公式预处理。
 *
 * 背景（真实用户反馈）：回答里的 `$E=mc^2$` 原样显示成纯文本 —— 那是问答侧
 * 压根没配 remark-math / rehype-katex，已在 Chat.jsx 补齐。
 *
 * 补上的插件还剩下一个"看起来修好了、其实没修好"的坑：
 * remark-math 只把**独立成行**的 `$$…$$` 认成块级公式（flow math），
 * 一行里写完的 `$$\int_0^1 x^2 dx$$` 会被当成**行内**公式（text math）——
 * 于是公式虽然排好了，但字号小、不居中、不换行，用户看到的仍然是"公式显示不正常"。
 * 而模型输出公式最常用的恰恰是单行 `$$E=mc^2$$`。
 *
 * 本模块在文本进入 ReactMarkdown **之前**做一次归一化，把
 *     $$E=mc^2$$          （整行只有一个公式）
 * 拆成
 *     $$
 *     E=mc^2
 *     $$
 * 交给 remark-math 当块级公式处理。
 */

/**
 * KaTeX 渲染选项（Chat.jsx 与 scripts/test-chat-katex.mjs 共用同一份，避免测试
 * 验的是另一套配置）。放在这里而不是 Chat.jsx，是因为 Chat.jsx 是 JSX，
 * Node 侧回归测试无法 import。
 *
 * - `throwOnError: false`：坏公式降级成 `.katex-error` 红字，不要炸掉整条回答。
 *   注：rehype-katex 内部会先 `throwOnError: true` 试一次、捕获后用
 *   `strict: 'ignore' + throwOnError: false` 重试，所以这层兜底不是唯一防线，
 *   但重试分支会继承这里的 options。
 * - `strict: false`：KaTeX 默认 strict='warn'，Unicode 文本进数学模式会刷警告；
 *   Android WebView 里这些警告没有去处，只增加无谓开销。
 * - `output: 'html'`：默认 'htmlAndMathml' 会同时输出 HTML 与 MathML 两套结构，
 *   靠 katex.min.css 把 MathML 那份在视觉上藏掉。一旦 CSS 没加载，两份内容会
 *   同时可见、叠字重影。只输出 HTML 既避免重影，也把公式 DOM 体积砍一半；
 *   代价是失去 MathML 的朗读能力，移动端 WebView 场景可接受。
 */
export const KATEX_OPTIONS = { throwOnError: false, strict: false, output: 'html' };

// 代码围栏起始行：最多 3 个空格缩进 + 连续 3 个以上反引号或波浪号。
// （4 个空格缩进在 markdown 里是缩进代码块，不是围栏，这里不匹配）
const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
// 代码围栏结束行：只有围栏字符，后面最多跟空白（与 CommonMark 一致）
const FENCE_CLOSE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// 整行只有一个公式：行首 0~3 个空格 + $$ + 内容 + $$ + 行尾空白。
// 缩进限制取 3 而不是"任意空白"，是刻意与 markdown 的块级缩进上限对齐：
// 4 个空格缩进的行属于缩进代码块，改它会把代码内容拆坏。
const WHOLE_LINE_MATH_RE = /^( {0,3})\$\$([^\n]+?)\$\$[ \t]*$/;
// 内容里还有未转义的 `$`：说明这一行不止一个公式（如 `$$a$$ $$b$$`），
// 或者本来就不是成对公式，一律不动，避免把语义改错。`\$` 视为已转义。
const INNER_DOLLAR_RE = /(^|[^\\])\$/;

/**
 * 把「整行只有一个 `$$…$$`」的行拆成块级公式的写法。
 *
 * 保证：
 * 1. 只处理整行就是一个公式的情况（行首行尾允许空白），句子中间的 `$$` 不动；
 * 2. 跳过 fenced code block（``` / ~~~）内部，代码里的 `$$` 原样保留；
 * 3. 不触碰行内公式 `$x$`（单美元符号，长度也匹配不上 `$$`）；
 * 4. 幂等：对已经是 `$$\n…\n$$` 的输入再跑一遍结果不变；
 * 5. 4 空格及以上缩进的行不动（缩进代码块，拆了会把代码内容改坏）。
 *
 * @param {string} text markdown 原文
 * @returns {string} 归一化后的 markdown（输入非字符串时返回空串）
 */
export function normalizeBlockMath(text) {
  const source = typeof text === 'string' ? text : '';
  // 快速返回：没有 `$$` 直接原样返回，避免每条流式增量都做一遍逐行扫描
  if (!source || source.indexOf('$$') === -1) return source;

  const lines = source.split(/\r?\n/);
  const out = [];
  // 当前所处的代码围栏：null 表示不在围栏内
  let fence = null;

  for (const line of lines) {
    if (fence) {
      out.push(line);
      const closing = FENCE_CLOSE_RE.exec(line);
      // 结束围栏的字符必须与开始的一致、长度不短于开始
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.size) {
        fence = null;
      }
      continue;
    }

    const opening = FENCE_OPEN_RE.exec(line);
    if (opening) {
      fence = { char: opening[1][0], size: opening[1].length };
      out.push(line);
      continue;
    }

    const whole = WHOLE_LINE_MATH_RE.exec(line);
    if (whole) {
      const indent = whole[1];
      const inner = whole[2];
      // 内容为空或含未转义 `$` 时放弃归一化，保持原样最安全
      if (inner.trim() && !INNER_DOLLAR_RE.test(inner)) {
        out.push(`${indent}$$`, `${indent}${inner.trim()}`, `${indent}$$`);
        continue;
      }
    }

    out.push(line);
  }

  return out.join('\n');
}
