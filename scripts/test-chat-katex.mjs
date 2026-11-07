#!/usr/bin/env node
/**
 * 问答公式渲染的回归测试（纯逻辑 + 真实渲染，不联网）。
 *
 * 锁定三起真实用户反馈 / 评审发现：
 *
 *  1) 回答里的 `$E=mc^2$` 原样显示成纯文本 —— 问答侧压根没配 remark-math /
 *     rehype-katex（只有 WikiView 配了）。修复后本测试守住「管线里确实有数学插件」。
 *
 *  2) 单行 `$$E=mc^2$$` 虽然能渲染，但被 remark-math 当成**行内**公式：
 *     字号小、不居中、不换行 —— 公式"能显示但显示不正常"，仍是用户报的那个问题。
 *     模型输出公式最常用的就是这种写法，所以预处理要把「整行只有一个 $$…$$」拆成
 *     块级形式（见 src/utils/markdownMath.js）。
 *
 *  3) 预处理必须"只动该动的"：代码块里的 `$$` 不能碰、行内 `$x$` 不能碰、
 *     幂等（已规范的不要重复加换行）。
 *
 * 用法：node scripts/test-chat-katex.mjs
 * 退出码：0 通过 / 1 失败
 */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import { KATEX_OPTIONS, normalizeBlockMath } from '../src/utils/markdownMath.js';

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

const norm = (s) => normalizeBlockMath(s);
const lines = (s) => s.split('\n');

// ==================== 1) 归一化：该拆的要拆 ====================
check(
  '单行 $$…$$ 拆成块级三行',
  norm('$$\\int_0^1 x^2 dx$$'),
  '$$\n\\int_0^1 x^2 dx\n$$'
);
check(
  '单行 $$…$$ 前后有空格也算整行公式',
  norm('  $$E=mc^2$$  '),
  '  $$\n  E=mc^2\n  $$'
);
check(
  '内容两端多余空白被去掉',
  norm('$$  E=mc^2  $$'),
  '$$\nE=mc^2\n$$'
);
check(
  '正文中间的公式行被替换，其余行原样',
  norm('下面给出公式：\n$$E=mc^2$$\n其中 c 为光速。'),
  '下面给出公式：\n$$\nE=mc^2\n$$\n其中 c 为光速。'
);

// ==================== 2) 归一化：不该拆的不能拆 ====================
check('行内 $x$ 不被动', norm('当 $x=1$ 时成立'), '当 $x=1$ 时成立');
check(
  '句子中间的 $$…$$ 不被动（只处理整行公式）',
  norm('质能方程 $$E=mc^2$$ 的解释'),
  '质能方程 $$E=mc^2$$ 的解释'
);
check(
  '同一行两个公式 $$a$$ $$b$$ 不动（内容含未转义 $）',
  norm('$$a$$ $$b$$'),
  '$$a$$ $$b$$'
);
check('未闭合的 $$ 不动', norm('$$E=mc^2'), '$$E=mc^2');
check('空的 $$$$ 不动', norm('$$$$'), '$$$$');
check(
  '4 空格缩进（缩进代码块）不动',
  norm('    $$E=mc^2$$'),
  '    $$E=mc^2$$'
);
check(
  '转义的 \\$ 不算第二个公式，照常拆',
  norm('$$\\$5 + \\$6$$'),
  '$$\n\\$5 + \\$6\n$$'
);

// ==================== 3) 归一化：幂等 ====================
const canonical = '$$\n\\frac{1}{2}\n$$';
check('已规范的三行块公式保持原样', norm(canonical), canonical);
check('对转换结果再跑一次不变（fixpoint）',
  norm(norm('$$E=mc^2$$')),
  norm('$$E=mc^2$$'));
check('多轮归一化结果稳定',
  norm(norm(norm(norm('$$a+b$$')))),
  '$$\na+b\n$$');
check(
  '已规范公式的行数不增加',
  lines(norm(canonical)).length,
  3
);

// ==================== 4) 归一化：必须跳过 fenced code block ====================
const fenced = '```\n$$E=mc^2$$\n```';
check('反引号围栏内的 $$ 不被替换', norm(fenced), fenced);
const fencedJs = '```js\nconst s = "$$x$$";\n```';
check('带语言标记的围栏同样跳过', norm(fencedJs), fencedJs);
const tilde = '~~~\n$$E=mc^2$$\n~~~';
check('波浪号围栏同样跳过', norm(tilde), tilde);
check(
  '围栏外的公式照常拆、围栏内的不动',
  norm('$$a$$\n```\n$$b$$\n```\n$$c$$'),
  '$$\na\n$$\n```\n$$b$$\n```\n$$\nc\n$$'
);
check(
  '未闭合的围栏之后一律不动（保守，宁可少拆）',
  norm('```\n$$a$$\n$$b$$'),
  '```\n$$a$$\n$$b$$'
);
check(
  '四个反引号的围栏也能识别',
  norm('````\n$$a$$\n````\n$$b$$'),
  '````\n$$a$$\n````\n$$\nb\n$$'
);

// ==================== 5) 归一化：异常输入不抛错 ====================
check('空串安全', norm(''), '');
check('非字符串安全', norm(null), '');
check('无 $$ 的文本原样返回', norm('普通段落\n\n$$不存在闭合'), '普通段落\n\n$$不存在闭合');

// ==================== 6) 真实渲染：与 Chat.jsx 同配置 ====================
// 配置来源与应用一致：KATEX_OPTIONS 从 utils 直接 import（同一份对象），
// 插件数组与 Chat.jsx 的 CHAT_REMARK_PLUGINS / CHAT_REHYPE_PLUGINS 逐字对应。
const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [[rehypeKatex, KATEX_OPTIONS], rehypeRaw];
const render = (md) => renderToStaticMarkup(
  createElement(ReactMarkdown, { remarkPlugins: REMARK_PLUGINS, rehypePlugins: REHYPE_PLUGINS },
    normalizeBlockMath(md))
);

// 归一化的效果：这正是 QA 复现出的那条
const singleLine = render('$$\\int_0^1 x^2 dx$$');
checkTrue('单行 $$…$$ 渲染出 katex-display', singleLine.includes('katex-display'), singleLine.slice(0, 160));
checkTrue('单行 $$…$$ 不再被包进 <p> 当行内公式', !/<p>\s*<span class="katex"/.test(singleLine));

// 既有行为不能回退
const multiLine = render('$$\n\\frac{1}{2}\n$$');
checkTrue('已独立成行的 $$…$$ 仍是块级', multiLine.includes('katex-display'));

const inline = render('质能方程 $E=mc^2$ 是核心。');
checkTrue('行内 $x$ 仍渲染为 katex', inline.includes('class="katex"'));
checkTrue('行内 $x$ 不应变成块级', !inline.includes('katex-display'));

const middle = render('质能方程 $$E=mc^2$$ 的解释');
checkTrue('句子中间的 $$…$$ 不被升级成块级', !middle.includes('katex-display'));

const codeBlock = render('```\n$$E=mc^2$$\n```');
checkTrue('代码块里的 $$ 原样保留、不渲染成公式', !codeBlock.includes('katex') && codeBlock.includes('$$E=mc^2$$'));

const mixed = render('$$a^2+b^2=c^2$$\n\n```\n$$not math$$\n```');
checkTrue('正文公式成块级、代码块公式不动', mixed.includes('katex-display') && mixed.includes('$$not math$$'));

checkTrue('坏公式渲染为 katex-error 而不是抛异常',
  render('$E=mc^$').includes('katex-error'));

// ==================== 7) 样式与接线（防止有人把配置改回去） ====================
const chatSrc = readFileSync(new URL('../src/components/Chat.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
checkTrue('Chat.jsx 引入 katex 样式（不再只靠 WikiView）',
  /import 'katex\/dist\/katex\.min\.css';/.test(chatSrc));
checkTrue('Chat.jsx 两处渲染都套了 normalizeBlockMath',
  (chatSrc.match(/normalizeBlockMath\(/g) || []).length >= 2);
check('KATEX_OPTIONS.output 为 html（避免 MathML 叠字）', KATEX_OPTIONS.output, 'html');
checkTrue('窄屏长公式可横向滚动（.katex-display overflow-x）',
  /\.katex-display\s*\{[^}]*overflow-x:\s*auto/.test(css));

// ==================== 汇总 ====================
console.log('');
if (failures.length) {
  console.log(`失败 ${failures.length} 项 / 共 ${pass + failures.length} 项`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log(`全部通过：问答公式渲染回归测试（${pass} 项）`);
process.exit(0);
