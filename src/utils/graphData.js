/**
 * Wiki 图谱数据的解析与索引（纯逻辑，便于单测锁定）。
 *
 * 【为什么要单独一层】v1.9.3 修的这个 bug 就是解析写错导致的：
 * GraphView 里写的是 `data?.data || {nodes:[],edges:[]}`，
 * 而 `/knowledgebase/{id}/wiki/graph` 的响应**没有 data 包裹层** ——
 * 顶层直接是 `{nodes, edges, meta}`。于是 `data.data` 恒为 undefined，
 * 每次都回退到空数组，界面永远显示「暂无图谱数据」，而服务端其实有
 * 311 个节点 / 1003 条边（实测）。
 *
 * 注意区分（实测确认，不要盲目统一）：
 *   - 详情类接口  /agents/{id}、/knowledge-bases/{id}   → **有** data 层
 *   - wiki 类接口  /wiki/graph、/wiki/pages             → **没有** data 层
 * 所以这里做兼容解析，而不是全局改掉 `data?.data`。
 */

/**
 * 把图谱响应规整成 { nodes, edges, meta }。
 * 兼容三种形态：顶层直给、包在 data 里、以及 data 是数组的退化情况。
 */
export function normalizeGraph(payload) {
  const empty = { nodes: [], edges: [], meta: {} };
  if (!payload || typeof payload !== 'object') return empty;

  const candidate = (payload.nodes || payload.edges || payload.meta)
    ? payload                       // 顶层形态（当前服务端就是这个）
    : (payload.data && typeof payload.data === 'object')
      ? payload.data                // 兼容 data 包裹形态
      : null;

  if (!candidate || Array.isArray(candidate)) return empty;

  const nodes = Array.isArray(candidate.nodes) ? candidate.nodes.filter(isUsableNode) : [];
  const rawEdges = Array.isArray(candidate.edges) ? candidate.edges.filter(isUsableEdge) : [];
  // 只保留两端节点都存在的边。
  // 服务端在大图会截断 nodes（meta.truncated=true），此时 edges 里会有指向未返回节点的边——
  // 这类边画不出来也点不开，更糟的是会虚增「关联数」（度数统计把不可见的邻居也算进去），
  // 让用户看到一个点不动的关联计数。
  const slugs = new Set(nodes.map((n) => n.slug));
  const edges = rawEdges.filter((e) => slugs.has(e.source) && slugs.has(e.target));
  const meta = candidate.meta && typeof candidate.meta === 'object' ? candidate.meta : {};
  return { nodes, edges, meta };
}

/** 该响应是否具备图谱结构（用于把「没建图」与「接口异常」区分开） */
export function looksLikeGraph(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const c = (payload.nodes || payload.edges || payload.meta)
    ? payload
    : (payload.data && typeof payload.data === 'object' ? payload.data : null);
  if (!c || Array.isArray(c)) return false;
  return Array.isArray(c.nodes) || Array.isArray(c.edges) || 'meta' in c;
}

// 节点必须有 slug 才能参与连边与选中，缺 slug 的直接丢弃
// （否则会出现 slug=undefined 的节点被所有边匹配到，图会乱）
function isUsableNode(n) {
  return n && typeof n === 'object' && typeof n.slug === 'string' && n.slug.length > 0;
}

function isUsableEdge(e) {
  return e && typeof e === 'object'
    && typeof e.source === 'string' && e.source.length > 0
    && typeof e.target === 'string' && e.target.length > 0;
}

/**
 * 预计算每个节点的关联数。
 *
 * 原实现在**每个节点里**做一次 `edges.filter(...)` ——
 * 500 个节点 × 5646 条边 ≈ 280 万次遍历，大图会明显卡顿。
 * 这里一次 O(E) 建表，之后 O(1) 查询。
 */
export function buildDegreeMap(edges, nodes) {
  const deg = new Map();
  for (const n of nodes || []) deg.set(n.slug, 0);
  for (const e of edges || []) {
    deg.set(e.source, (deg.get(e.source) || 0) + 1);
    deg.set(e.target, (deg.get(e.target) || 0) + 1);
  }
  return deg;
}

/** 以 slug → node 建索引 */
export function buildNodeIndex(nodes) {
  const idx = new Map();
  for (const n of nodes || []) {
    if (!idx.has(n.slug)) idx.set(n.slug, n);
  }
  return idx;
}

/**
 * 取某个节点的邻居 slug 集合。
 * 注意这是**有向**连边（source→target），两个方向都算关联 ——
 * 与原实现一致（原实现同时比对 source 与 target）。
 */
export function neighborSlugs(edges, slug) {
  const out = new Set();
  if (!slug) return out;
  for (const e of edges || []) {
    if (e.source === slug) out.add(e.target);
    else if (e.target === slug) out.add(e.source);
  }
  return out;
}

/**
 * 默认排序：关联多的排前面。
 *
 * 大图（实测最大 500 节点）按原顺序列出来意义不大 ——
 * 真正重要的枢纽节点可能排在几十位之后，用户得一直往下翻。
 */
export function sortByImportance(nodes, degree, linkCountField = 'link_count') {
  return [...(nodes || [])].sort((a, b) => {
    const da = Number(a[linkCountField]) || degree?.get(a.slug) || 0;
    const db = Number(b[linkCountField]) || degree?.get(b.slug) || 0;
    if (db !== da) return db - da;
    return String(a.title || a.slug).localeCompare(String(b.title || b.slug), 'zh');
  });
}

/**
 * 关联网址：把 wiki 页面 slug 转成 App 内的路由。
 * slug 形如 `entity/zif-8` / `concept/bet-surface-area`。
 */
export function slugToRoute(slug) {
  if (!slug || typeof slug !== 'string') return null;
  return `/knowledge/${encodeURIComponent(slug)}`;
}

/**
 * 把图谱接口的错误转成人话。
 *
 * 实测：`mode=ego` 传一个不存在的 center 时，服务端返回 **HTTP 500**
 * 且 error 是 `ego center slug "x" not found` —— 直接摊给用户会莫名其妙。
 */
export function explainGraphError(err) {
  const raw = typeof err === 'string' ? err : (err?.message || '');
  if (!raw) return '图谱加载失败';
  if (/not found/i.test(raw) && /center/i.test(raw)) {
    return '该节点已不在图谱中（可能被重新生成过），已为你切回全图。';
  }
  if (/HTTP 5\d\d/.test(raw)) {
    return `图谱服务返回异常（${raw.match(/HTTP \d+/)?.[0] || ''}）。可稍后重试，或检查知识库的图索引是否正常。`;
  }
  if (/HTTP 401|HTTP 403/.test(raw)) {
    return '没有查看该图谱的权限，请确认登录状态。';
  }
  return raw;
}

/** 图谱是否为空（用于决定展示「暂无数据」提示） */
export function isGraphEmpty(graph) {
  return !graph || !Array.isArray(graph.nodes) || graph.nodes.length === 0;
}

/**
 * 判断「空图」是否值得怀疑。
 *
 * 服务端返回了 meta 却没有任何节点，说明接口是通的但确实没建图索引；
 * 若连 meta 都没有，通常是解析或接口异常 —— 这两种情况的提示文案不该一样，
 * 否则用户会被"请在设置中开启图索引"误导去改一个本来就正常的地方。
 */
export function emptyReason(graph, rawPayload) {
  // 先判「接口有没有返回图谱结构」——这决定提示方向。
  // 只有当响应本身就是图谱结构、却没有节点时，才谈得上"未生成"。
  const structured = looksLikeGraph(rawPayload !== undefined ? rawPayload : graph);
  if (!structured) {
    return { kind: 'unknown', message: '未收到图谱数据，可能是接口返回异常。' };
  }
  const total = Number(graph?.meta?.total);
  if (Number.isFinite(total) && total > 0) {
    // 有总数但节点被过滤空了 —— 数据异常而非未建索引
    return { kind: 'filtered', message: `服务端有 ${total} 个节点，但都缺少必要的 slug 字段，无法绘制。` };
  }
  return { kind: 'not-built', message: '该知识库尚未生成 Wiki 图谱。' };
}
