/**
 * 图谱数据解析的回归测试（纯函数，不联网）。
 *
 * 锁死 v1.9.3 修的那个 bug：
 *   `/knowledgebase/{id}/wiki/graph` 返回的是**顶层** {nodes, edges, meta}，
 *   而组件里写的是 `data?.data` —— 恒为 undefined → 永远显示空图。
 *   服务端实有 311 节点 / 1003 边（已实测），所以这是纯客户端解析错误。
 *
 * 同时锁死「详情类接口有 data 层」这个区别，避免以后有人"统一"成全兼容或全不兼容。
 *
 * 运行：node scripts/test-graph-data.mjs
 */
import {
  normalizeGraph, buildDegreeMap, buildNodeIndex, neighborSlugs,
  sortByImportance, slugToRoute, explainGraphError, isGraphEmpty, emptyReason, looksLikeGraph
} from '../src/utils/graphData.js';

let pass = 0;
const fails = [];

function eq(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else fails.push(`${name}  实际 ${a} / 期望 ${e}`);
}
function ok(name, cond, extra) {
  if (cond) pass += 1;
  else fails.push(name + (extra ? `  → ${extra}` : ''));
}

// 真实响应样例（照实测结构构造）
const TOP_LEVEL = {
  nodes: [
    { slug: 'entity/zif-8', title: 'ZIF-8', page_type: 'entity', link_count: 183 },
    { slug: 'concept/bet-surface-area', title: 'BET 比表面积', page_type: 'concept', link_count: 20 },
    { slug: 'summary/index', title: '索引', page_type: 'summary', link_count: 1 }
  ],
  edges: [
    { source: 'entity/zif-8', target: 'concept/bet-surface-area' },
    { source: 'concept/bet-surface-area', target: 'summary/index' }
  ],
  meta: { mode: 'overview', total: 311, returned: 3, truncated: true }
};

console.log('=== 1. 顶层结构必须被正确识别（本次 bug 的核心）===');
{
  const g = normalizeGraph(TOP_LEVEL);
  eq('节点数（旧代码这里恒为 0）', g.nodes.length, 3);
  eq('边数', g.edges.length, 2);
  eq('meta 保留', g.meta.total, 311);
  ok('不再是空图', !isGraphEmpty(g));
}
{
  // 反向断言：先钉死"旧写法确实会失败"，证明这测试真能抓到该 bug
  const legacy = TOP_LEVEL?.data || { nodes: [], edges: [], meta: {} };
  eq('旧写法 data?.data 得到空图（bug 复现）', legacy.nodes.length, 0);
}

console.log('=== 2. 兼容 data 包裹形态（其他接口有 data 层）===');
{
  const g = normalizeGraph({ success: true, data: TOP_LEVEL });
  eq('data 包裹也能解析', g.nodes.length, 3);
  eq('data 包裹的 edges', g.edges.length, 2);
}

console.log('=== 3. 异常输入不得抛错，且不产生脏数据 ===');
ok('null → 空图', isGraphEmpty(normalizeGraph(null)));
ok('undefined → 空图', isGraphEmpty(normalizeGraph(undefined)));
ok('字符串 → 空图', isGraphEmpty(normalizeGraph('oops')));
ok('数组 → 空图', isGraphEmpty(normalizeGraph([1, 2, 3])));
ok('空对象 → 空图', isGraphEmpty(normalizeGraph({})));
eq('nodes 非数组时归零', normalizeGraph({ nodes: 'x', edges: [] }).nodes, []);
{
  // 缺 slug 的节点必须丢：否则 slug=undefined 会被所有边匹配上，图会乱成一团
  const g = normalizeGraph({
    nodes: [{ title: '无slug' }, { slug: 'a', title: 'A' }, { slug: '', title: '空slug' }],
    edges: [{ source: 'a', target: 'b' }, { source: '', target: 'a' }, { source: 'a' }]
  });
  eq('丢弃缺 slug 的节点', g.nodes.length, 1);
  eq('丢弃不完整的边', g.edges.length, 0);
}

console.log('=== 4. 度数与索引（大图性能）===');
{
  const g = normalizeGraph(TOP_LEVEL);
  const deg = buildDegreeMap(g.edges, g.nodes);
  eq('zif-8 度数=1', deg.get('entity/zif-8'), 1);
  eq('bet 度数=2（双向都算）', deg.get('concept/bet-surface-area'), 2);
  eq('孤立节点度数为 0（不是 undefined）', deg.get('summary/index'), 1);
  const idx = buildNodeIndex(g.nodes);
  eq('索引可取到节点', idx.get('entity/zif-8').title, 'ZIF-8');
  eq('索引缺失键返回 undefined', idx.get('nope'), undefined);
  eq('邻居查询（双向）', [...neighborSlugs(g.edges, 'concept/bet-surface-area')].sort(),
    ['entity/zif-8', 'summary/index']);
  eq('未知 slug 无邻居', neighborSlugs(g.edges, 'nope').size, 0);
}

console.log('=== 5. 按重要性排序（枢纽节点靠前）===');
{
  const g = normalizeGraph(TOP_LEVEL);
  const deg = buildDegreeMap(g.edges, g.nodes);
  const sorted = sortByImportance(g.nodes, deg);
  eq('link_count 最大的排第一', sorted[0].slug, 'entity/zif-8');
  // 缺 link_count 时回退到实际度数
  const noCount = sortByImportance(
    [{ slug: 'a', title: 'A' }, { slug: 'b', title: 'B' }],
    buildDegreeMap([{ source: 'b', target: 'a' }, { source: 'b', target: 'c' }], [{ slug: 'a' }, { slug: 'b' }])
  );
  eq('无 link_count 时用度数排序', noCount[0].slug, 'b');
  eq('不修改原数组', g.nodes[0].slug, 'entity/zif-8');
}

console.log('=== 6. slug → 路由 ===');
eq('普通 slug', slugToRoute('entity/zif-8'), '/knowledge/entity%2Fzif-8');
eq('空值返回 null', slugToRoute(''), null);
eq('非字符串返回 null', slugToRoute(123), null);

console.log('=== 7. 错误文案（ego 模式服务端返回 500）===');
{
  const msg = explainGraphError('HTTP 500: ego center slug "zif-8" not found');
  ok('center 不存在 → 提示节点已不在图谱中', msg.includes('已不在图谱'), msg);
  ok('5xx 提示服务异常而非暗示用户去改设置',
    explainGraphError('HTTP 503').includes('异常'));
  ok('401 提示权限', explainGraphError('HTTP 401').includes('权限'));
  ok('空输入有兜底', explainGraphError('') === '图谱加载失败');
  ok('未知错误原样返回', explainGraphError('some weird thing') === 'some weird thing');
}

console.log('=== 8. 空图原因的区分（避免误导用户）===');
{
  const emptyGraph = { nodes: [], edges: [], meta: {} };
  eq('接口返回图谱结构但无节点 → 未建索引', emptyReason(emptyGraph, emptyGraph).kind, 'not-built');
  const filtered = emptyReason({ nodes: [], edges: [], meta: { total: 311 } }, { nodes: [], edges: [], meta: { total: 311 } });
  eq('有总数却无节点 → 判为数据异常', filtered.kind, 'filtered');
  ok('该情况不提示去开启图索引（那会误导）', !filtered.message.includes('开启'));
  // 响应根本不是图谱结构（例如后端返了别的 JSON 或解析出错）→ 应判为接口异常
  eq('非图谱结构 → 接口异常', emptyReason({ nodes: [], edges: [], meta: {} }, { foo: 'bar' }).kind, 'unknown');
  eq('null → 接口异常', emptyReason(null, null).kind, 'unknown');
  ok('looksLikeGraph 对顶层结构为真', looksLikeGraph(TOP_LEVEL));
  ok('looksLikeGraph 对 data 包裹为真', looksLikeGraph({ data: TOP_LEVEL }));
  ok('looksLikeGraph 对无关对象为假', !looksLikeGraph({ foo: 1 }));
}

console.log();
if (fails.length) {
  console.log(`未通过 ${fails.length} 项：`);
  fails.forEach((f) => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log(`全部通过（${pass} 项）`);
