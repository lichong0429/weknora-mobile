// 解析状态语义（对齐 WeKnora 后端 internal/types/knowledge.go 的 ParseStatus 常量）
//
//   pending     已入队，等待 worker 取任务
//   processing  DocReader / 分块 / 向量化 进行中
//   finalizing  主解析已结束，摘要/问题生成/图谱抽取等增强子任务仍在跑
//               （此时文档已可被检索，但仍在消耗资源，仍可被 cancel-parse 打断）
//   completed   全部结束，终态
//   failed      失败，终态
//   cancelled   用户主动取消，终态（chunk 与索引保留，可随时 reparse）
//   deleting    删除中，用于阻止异步任务冲突

export const PARSE_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  FINALIZING: 'finalizing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  DELETING: 'deleting'
};

// 后端「在飞行中」的三个状态：只有这些状态值得轮询，也只有这些可以被取消/重新解析
const IN_FLIGHT = new Set([
  PARSE_STATUS.PENDING,
  PARSE_STATUS.PROCESSING,
  PARSE_STATUS.FINALIZING
]);

const META = {
  [PARSE_STATUS.PENDING]: { label: '待解析', chip: 'bg-gray-100 text-gray-600', dot: 'bg-gray-400' },
  [PARSE_STATUS.PROCESSING]: { label: '解析中', chip: 'bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
  [PARSE_STATUS.FINALIZING]: { label: '收尾中', chip: 'bg-indigo-50 text-indigo-700', dot: 'bg-indigo-500' },
  [PARSE_STATUS.COMPLETED]: { label: '已完成', chip: 'bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  [PARSE_STATUS.FAILED]: { label: '失败', chip: 'bg-red-50 text-red-700', dot: 'bg-red-500' },
  [PARSE_STATUS.CANCELLED]: { label: '已取消', chip: 'bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  [PARSE_STATUS.DELETING]: { label: '删除中', chip: 'bg-gray-100 text-gray-500', dot: 'bg-gray-400' }
};

const UNKNOWN = { label: '未知', chip: 'bg-gray-100 text-gray-500', dot: 'bg-gray-300' };

export function isInFlight(status) {
  return IN_FLIGHT.has(status);
}

export function statusMeta(status) {
  return META[status] || UNKNOWN;
}

export function statusLabel(status) {
  return statusMeta(status).label;
}

// 是否存在需要继续轮询的文档
export function countInFlight(items) {
  if (!Array.isArray(items)) return 0;
  return items.filter((it) => isInFlight(it?.parse_status)).length;
}

export function hasInFlight(items) {
  return countInFlight(items) > 0;
}

// 轮询「指纹」：只在这些字段变化时才需要重建定时器，
// 避免每渲染一次就重设定时器（会造成刷新频率抖动）。
export function inFlightSignature(items) {
  if (!Array.isArray(items)) return '';
  return items
    .filter((it) => isInFlight(it?.parse_status))
    .map((it) => `${it.id}:${it.parse_status}:${it.pending_subtasks_count ?? 0}:${it.last_activity_at || ''}`)
    .sort()
    .join('|');
}

// 距上次活动过了多久（毫秒）。后端在列表项里给 last_activity_at。
export function idleMs(item, now = Date.now()) {
  if (!item?.last_activity_at) return 0;
  const last = Date.parse(item.last_activity_at);
  if (Number.isNaN(last)) return 0;
  return Math.max(0, now - last);
}

// 全部在飞行中的文档都长时间没有推进 → 判定为整体停滞，轮询降频（省电/省流量）。
// 阈值与网页端一致：20 分钟。
export const STALL_THRESHOLD_MS = 20 * 60 * 1000;

export function allStalled(items, now = Date.now()) {
  const running = (items || []).filter((it) => isInFlight(it?.parse_status));
  if (running.length === 0) return false;
  return running.every((it) => idleMs(it, now) >= STALL_THRESHOLD_MS);
}

// 「已耗时」文案：给解析中的文档一个可感知的时间尺度（后端不下发解析百分比，
// 所以这里只展示时间，不伪造进度条）
export function formatElapsed(fromIso, now = Date.now()) {
  if (!fromIso) return '';
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return '';
  const sec = Math.max(0, Math.floor((now - from) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}min`;
  const hr = Math.floor(min / 60);
  return `${hr}h${min % 60}m`;
}

export function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ---------------------------------------------------------------------------
// 解析阶段追踪（GET /knowledge/{id}/stages）
//
// 后端把一次解析拆成 5 个阶段（types.AllStages），每个阶段是一个 span，
// 失败时通过 DAG 依赖把下游阶段级联标记为 cancelled，因此时间线能直接
// 显示「炸伤范围」。这里只做展示层的语义映射。
// ---------------------------------------------------------------------------

// 顺序与后端 types.AllStages 一致，不要随意调整
export const STAGE_ORDER = ['docreader', 'chunking', 'embedding', 'multimodal', 'postprocess'];

const STAGE_LABEL = {
  docreader: '文档解析',
  chunking: '分块',
  embedding: '向量化',
  multimodal: '多模态',
  postprocess: '后处理',
  knowledge_processing: '整体处理'
};

export function stageLabel(name) {
  return STAGE_LABEL[name] || name || '未知阶段';
}

// span 状态（后端 types.SpanStatus*）
const SPAN_META = {
  pending: { label: '等待', chip: 'bg-gray-100 text-gray-600' },
  running: { label: '进行中', chip: 'bg-blue-50 text-blue-700' },
  done: { label: '完成', chip: 'bg-emerald-50 text-emerald-700' },
  failed: { label: '失败', chip: 'bg-red-50 text-red-700' },
  skipped: { label: '跳过', chip: 'bg-gray-100 text-gray-500' },
  cancelled: { label: '已取消', chip: 'bg-amber-50 text-amber-700' }
};

export function spanMeta(status) {
  return SPAN_META[status] || { label: status || '未知', chip: 'bg-gray-100 text-gray-500' };
}

// trace 是单棵树的根节点（SpanTreeNode 内嵌 span 字段 + children）。
// 取出 5 个阶段节点并按固定顺序排列；后端在无 tracing 数据时会合成
// 5 个 pending 占位阶段，因此这里对缺失阶段也补占位，保证时间线始终完整。
export function extractStages(trace) {
  const found = new Map();
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'stage' && node.name) found.set(node.name, node);
    (node.children || []).forEach(walk);
  };
  if (Array.isArray(trace)) trace.forEach(walk);
  else walk(trace);

  return STAGE_ORDER.map((name) => found.get(name) || {
    name,
    kind: 'stage',
    status: 'pending',
    _placeholder: true
  });
}

// 该条解析记录是否包含真实 trace（而非后端合成的占位时间线）
export function hasRealTrace(payload) {
  if (!payload?.trace) return false;
  return Boolean(payload.trace.span_id || (payload.current_attempt ?? 0) > 0);
}

export function formatDuration(ms) {
  if (!ms && ms !== 0) return '';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)}s`;
  const min = Math.floor(sec / 60);
  return `${min}m${Math.round(sec % 60)}s`;
}

