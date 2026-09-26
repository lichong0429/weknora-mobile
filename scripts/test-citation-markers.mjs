#!/usr/bin/env node
/**
 * 回归测试：回答正文里的引用标记解析
 * ---------------------------------------------------------------------------
 * 锁定的事故：WeKnora 在回答正文里插入
 *     <kb  doc="…" chunk_id="…" kb_id="…" />   知识库文档引用
 *     <web url="…" title="…" />                联网搜索引用（Agent 模式常见）
 * 网页端渲染成可点胶囊（文档引用按 chunk id 现取原文，联网引用开新标签），
 * 而手机端把整段交给 Markdown 渲染时这些属未知标签，被浏览器忽略 ——
 * 引用既不显示也点不开。
 *
 * 另有三条容易被忽略、但网页端专门处理过的细节，这里一并锁住：
 *   1. 流式过程中未收完的半个标签必须掐掉，否则正文漏出 `<kb doc="1-s2.0…` 乱码；
 *   2. 模型可能给非 UUID 的引用（FAQ-1 / DOC-2 / 纯序号），要映射回真实 chunk；
 *   3. 替换后的链接绝不能是 #锚点 —— App 用 HashRouter，改 hash 会被当成路由跳转弹回首页。
 *
 * 用法：node scripts/test-citation-markers.mjs
 */
import {
  extractCitations,
  extractInlineThinking,
  resolveCitation,
  resolveCitationChunkId,
  stripIncompleteCitationTag,
  truncateMiddle,
  domainOf,
  hasCitations,
  CITE_KB_PREFIX,
  CITE_WEB_PREFIX
} from '../src/utils/citationMarkers.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n      got  = ${JSON.stringify(got)}\n      want = ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, Boolean(cond), true);

const refs = [
  { id: 'c1', knowledge_title: '文档A', knowledge_filename: 'a.pdf', content: '片段内容一', knowledge_id: 'kid-1' },
  { id: 'c9', knowledge_title: '文档B', knowledge_filename: 'b.pdf', content: '片段内容九', knowledge_id: 'kid-9', chunk_type: 'faq' }
];

// --- 1) 文档引用（真实抓取自 NAS 的回答）---
const REAL = 'ZIF-8 膜选择性可达 55'
  + ' <kb doc="1-s2.0-S2542529325001968-main.pdf" chunk_id="eddcbaef-b6e5-492c-bfca-0405e6f54f45" kb_id="c5ef14fa-4afb-43d7-a5cc-3e150c34be6b" />'
  + '，H₂/C₃H₈ 达 2000 <kb doc="a.pdf" chunk_id="0ac7604e-87c6-41c0-88f3-beef12789634" />'
  + '。同类 <kb doc="1-s2.0-S2542529325001968-main.pdf" chunk_id="eddcbaef-b6e5-492c-bfca-0405e6f54f45" kb_id="c5ef14fa-4afb-43d7-a5cc-3e150c34be6b" />。';

const real = extractCitations(REAL, refs);
check('3 处标记 → 2 条去重引用', real.markers.length, 2);
check('编号按首次出现顺序连续', real.markers.map((m) => m.number), [1, 2]);
check('重复引用复用编号 1', (real.text.match(/\[1\]\(cite:kb:1\)/g) || []).length, 2);
check('标记已被替换，无残留标签', real.text.includes('<kb'), false);
ok('使用 cite:kb: 协议', real.text.includes(`[1](${CITE_KB_PREFIX}1)`));
ok('绝不含 #锚点（HashRouter 会把页面弹回首页）', !real.text.includes('](#'));
check('正文文字未破坏', real.text.startsWith('ZIF-8 膜选择性可达 55'), true);
check('doc 解析正确', real.markers[0].doc, '1-s2.0-S2542529325001968-main.pdf');
check('chunk_id 解析正确', real.markers[1].chunkId, '0ac7604e-87c6-41c0-88f3-beef12789634');
check('kind 标记为文档引用', real.markers.map((m) => m.kind), ['kb', 'kb']);

// --- 2) 联网引用（Agent 模式）---
const WEB = '根据最新报道 <web url="https://www.nature.com/articles/x" title="Nature 新闻" /> '
  + '以及 <web url="https://arxiv.org/abs/2501.00001" title="arXiv 预印本" />。';
const web = extractCitations(WEB, refs);
check('识别 2 条联网引用', web.markers.length, 2);
check('kind 为 web', web.markers.map((m) => m.kind), ['web', 'web']);
ok('使用 cite:web: 协议', web.text.includes(`[1](${CITE_WEB_PREFIX}1)`));
check('保留 url', web.markers[0].url, 'https://www.nature.com/articles/x');
check('域名归一化', domainOf(web.markers[1].url), 'arxiv.org');
ok('无残留 <web 标签', !web.text.includes('<web'));
// 同一条网页被引用多次时复用编号
const webDup = extractCitations('<web url="https://a.com/1" title="t" /> 和 <web url="https://a.com/1" title="t" />', refs);
check('同一网页复用编号', webDup.markers.length, 1);
// url 缺失时丢弃标记，不留空胶囊
check('缺 url 的联网标记被丢弃', extractCitations('前 <web title="无链接" /> 后', refs).markers.length, 0);

// --- 3) 流式未收完的标签必须掐掉 ---
check('未闭合 <kb 被截断', stripIncompleteCitationTag('回答内容 <kb doc="1-s2.0'), '回答内容 ');
check('未闭合 <web 被截断', stripIncompleteCitationTag('见 <we'), '见 ');
check('只有半个尖括号也截断', stripIncompleteCitationTag('说明 <'), '说明 ');
check('正常的小于号不误伤', stripIncompleteCitationTag('条件是 a < b 成立'), '条件是 a < b 成立');
check('已闭合标签不受影响', stripIncompleteCitationTag('见 <kb doc="a.pdf" chunk_id="c1" /> 后'), '见 <kb doc="a.pdf" chunk_id="c1" /> 后');
check('web 已闭合不受影响', stripIncompleteCitationTag('<web url="https://a.com" />'), '<web url="https://a.com" />');

// --- 4) 非 UUID 引用的还原（网页端 resolveCitationChunkId 的等价实现）---
check('UUID 原样返回', resolveCitationChunkId('0ac7604e-87c6-41c0-88f3-beef12789634', {}, refs), '0ac7604e-87c6-41c0-88f3-beef12789634');
check('按文档名还原', resolveCitationChunkId('3', { doc: 'a.pdf' }, refs), 'c1');
check('FAQ-1 → 第 1 条 faq 引用', resolveCitationChunkId('FAQ-1', {}, refs), 'c9');
check('DOC-1 → 第 1 条非 faq 引用', resolveCitationChunkId('DOC-1', {}, refs), 'c1');
check('纯序号 1 → 第 1 条引用', resolveCitationChunkId('1', {}, refs), 'c1');
check('纯序号 2 → 第 2 条引用', resolveCitationChunkId('2', {}, refs), 'c9');
check('无引用列表时原样返回', resolveCitationChunkId('FAQ-1', {}, []), 'FAQ-1');

// --- 5) <think> 抽取 ---
const t1 = extractInlineThinking('<think>先想一下</think>正文开始。');
check('闭合 think：正文', t1.text, '正文开始。');
check('闭合 think：思考内容', t1.thinking, '先想一下');
const t2 = extractInlineThinking('<think>还在想');
check('流式中未闭合 think：正文为空', t2.text, '');
check('流式中未闭合 think：思考内容可见', t2.thinking, '还在想');
check('无 think 原样返回', extractInlineThinking('普通正文').text, '普通正文');

// --- 6) 标记与引用列表对齐 ---
const hit = resolveCitation({ kind: 'kb', chunkId: 'c1', doc: 'a.pdf' }, refs);
check('按 chunk_id 命中', hit.content, '片段内容一');
check('命中后带出来源文档 id', hit.knowledge_id, 'kid-1');
const byDoc = resolveCitation({ kind: 'kb', chunkId: 'missing', doc: 'b.pdf' }, refs);
check('chunk 对不上时按文件名兜底', byDoc.content, '片段内容九');
const miss = resolveCitation({ kind: 'kb', chunkId: 'nope', doc: 'x.pdf' }, refs);
check('完全对不上时标记未命中（由详情弹层按 id 现取）', miss._unmatched, true);
check('未命中仍显示来源文档名', miss.knowledge_title, 'x.pdf');
const webRef = resolveCitation({ kind: 'web', url: 'https://www.nature.com/articles/x', title: 'Nature 新闻' }, refs);
check('联网引用可解析', webRef._web, true);
check('联网引用缺标题时用域名兜底', resolveCitation({ kind: 'web', url: 'https://x.com/a' }, refs).knowledge_title, 'x.com');

// --- 7) [[wiki 页面]] 链接 ---
const wiki1 = extractCitations('详见 [[concepts/混合基质膜]] 与 [[entities/zif-8|ZIF-8 条目]]。', refs);
check('wiki 链接显示名：去首段路径', wiki1.text.includes('[混合基质膜](wiki:'), true);
check('wiki 链接显示名：带 | 时用显式显示名', wiki1.text.includes('[ZIF-8 条目](wiki:'), true);
ok('slug 被编码进链接', wiki1.text.includes('wiki:' + encodeURIComponent('concepts/混合基质膜')));
ok('无残留双方括号', !wiki1.text.includes('[['));
check('wiki 链接不产生引用标记（不需弹层）', wiki1.markers.length, 0);
check('未闭合 [[ 被截断', stripIncompleteCitationTag('说明 [[conce'), '说明 ');
check('已闭合 [[ ]] 不受影响', stripIncompleteCitationTag('见 [[a/b]] 页').includes('[[a/b]]'), true);
check('普通单方括号不受影响', stripIncompleteCitationTag('[普通链接](http://a.com)'), '[普通链接](http://a.com)');
check('hasCitations 识别 wiki 链接', hasCitations('见 [[a/b]]'), true);
check('显示名中的方括号被清理', extractCitations('[[a/b|[x]]]', refs).text.includes('[x](wiki:'), true);

// --- 8) 展示辅助与整体判定 ---
// 中间省略：两端各留 5 字符（名字本身以 . 结尾时会连出多个点，与网页端算法一致）
check('文档名中间省略', truncateMiddle('1-s2.0-S2542529325001968-main.pdf', 13), '1-s2....n.pdf');
check('短名不省略', truncateMiddle('a.pdf'), 'a.pdf');
check('hasCitations 判定', [hasCitations(REAL), hasCitations(WEB), hasCitations('无')], [true, true, false]);
check('空值安全', [extractCitations(null, refs).text, extractCitations(undefined, refs).markers.length], ['', 0]);
check('两种标记混排各自编号', extractCitations('<kb doc="a.pdf" chunk_id="c1" /> 与 <web url="https://a.com" />', refs).markers.map((m) => m.kind), ['kb', 'web']);

console.log(failed ? `\n未通过：${failed} 项` : '\n全部通过：引用标记解析回归测试');
process.exit(failed ? 1 : 0);
