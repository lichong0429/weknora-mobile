/**
 * 用真实服务端数据验证图谱解析修复（一次性验证脚本，需内网环境）。
 *
 * 目的：证明修复后的 normalizeGraph 能从真实响应里解析出节点，
 * 而不是只在构造的测试数据上通过。
 *
 * 运行：WK_BASE=http://<你的实例地址>:8080/api/v1 WK_KEY=<api_key> node scripts/verify-graph-live.mjs
 *
 * 注意：这里**不写默认地址**。本仓库是公开的，任何内网/Tailscale 地址写进源码
 * 都会被 CI 的安全预检拦下（private-ip 规则），也会泄露内网拓扑。
 */

import {
  normalizeGraph, buildDegreeMap, sortByImportance, isGraphEmpty, looksLikeGraph
} from '../src/utils/graphData.js';

const BASE = process.env.WK_BASE;
const KEY = process.env.WK_KEY;
if (!BASE || !KEY) {
  console.error('缺少环境变量。用法：');
  console.error('  WK_BASE=http://<你的实例地址>:8080/api/v1 WK_KEY=<api_key> node scripts/verify-graph-live.mjs');
  process.exit(1);
}

async function api(path) {
  const res = await fetch(BASE + path, {
    headers: { 'X-API-Key': KEY, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const list = await api('/knowledge-bases?page=1&page_size=100');
const kbs = (list.data || []).slice(0, 6);
console.log(`抽查 ${kbs.length} 个知识库的图谱接口\n`);
console.log('知识库'.padEnd(24) + '节点'.padEnd(8) + '关联'.padEnd(8) + '解析'.padEnd(8) + '旧代码(data.data)');
console.log('-'.repeat(72));

let fixedOk = 0;
let legacyEmpty = 0;

for (const kb of kbs) {
  let raw;
  try {
    raw = await api(`/knowledgebase/${kb.id}/wiki/graph?mode=overview`);
  } catch (err) {
    console.log(`${(kb.name || '').slice(0, 22).padEnd(24)}请求失败: ${err.message}`);
    continue;
  }

  // 修复后的解析
  const g = normalizeGraph(raw);
  // 旧代码的解析（data?.data || 空图），用来对照
  const legacy = raw?.data || { nodes: [], edges: [], meta: {} };

  const okFixed = !isGraphEmpty(g);
  const okLegacy = (legacy.nodes || []).length > 0;
  if (okFixed) fixedOk += 1;
  if (!okLegacy && (raw.nodes || []).length > 0) legacyEmpty += 1;

  console.log(
    (kb.name || '').slice(0, 22).padEnd(24)
    + String(g.nodes.length).padEnd(8)
    + String(g.edges.length).padEnd(8)
    + (okFixed ? '✓ 有数据' : '✗ 空').padEnd(8)
    + (okLegacy ? '也有' : '✗ 空（这就是 bug）')
  );
}

console.log();
console.log(`修复后能解析出数据: ${fixedOk}/${kbs.length}`);
console.log(`旧代码解析为空、而服务端实有数据: ${legacyEmpty} 个知识库`);
console.log();
console.log('举证用的结构判断:');
const sample = await api(`/knowledgebase/${kbs[0].id}/wiki/graph?mode=overview`);
console.log('  响应顶层字段:', Object.keys(sample).join(', '));
console.log('  有 data 包裹层:', 'data' in sample);
console.log('  looksLikeGraph(raw):', looksLikeGraph(sample));

// 排序验证（大图应把枢纽节点排前面）
const g0 = normalizeGraph(sample);
const deg = buildDegreeMap(g0.edges, g0.nodes);
const sorted = sortByImportance(g0.nodes, deg);
console.log();
console.log('排序后的前 5 个节点（应为枢纽）:');
sorted.slice(0, 5).forEach((n, i) => {
  console.log(`  ${i + 1}. ${(n.title || n.slug).slice(0, 30).padEnd(32)} 关联 ${deg.get(n.slug) || 0}`);
});

process.exit(fixedOk === kbs.length ? 0 : 1);
