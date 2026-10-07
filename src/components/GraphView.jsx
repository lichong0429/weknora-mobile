import { useMemo, useState } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { Wiki } from '../api/endpoints.js';
import {
  normalizeGraph, buildDegreeMap, buildNodeIndex, neighborSlugs,
  sortByImportance, explainGraphError, isGraphEmpty, emptyReason
} from '../utils/graphData.js';
import {
  Share2, Loader2, AlertCircle, Search, Target, Circle, ArrowRight, RotateCw,
  ChevronDown
} from 'lucide-react';
import { clsx } from 'clsx';

const TYPE_COLORS = {
  summary: '#3b82f6',
  entity: '#10b981',
  concept: '#8b5cf6',
  synthesis: '#f59e0b',
  comparison: '#ef4444',
  other: '#6b7280'
};

// 大图列表分页渲染：一次只渲染这么多条。
// 实测某些知识库返回 500 个节点，全量渲染 DOM 会明显卡顿；
// 且真正重要的枢纽节点已按关联数排到前面，无需一屏塞满。
const LIST_PAGE_SIZE = 60;
// SVG 小图最多画多少个节点（边太密时画出来是一团线，没有信息量）
const SVG_MAX_NODES = 30;
// SVG 最多画多少条边
const SVG_MAX_EDGES = 120;

function GraphView({ kbId }) {
  const [center, setCenter] = useState('');
  const [query, setQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);

  const { data, loading, error, run } = useAsync(
    () => Wiki.getGraph(kbId, center ? { mode: 'ego', center, depth: 2 } : { mode: 'overview' }),
    [kbId, center]
  );

  // 解析与索引全部走 useMemo：大图上每次渲染重算会让滚动卡顿
  const graph = useMemo(() => normalizeGraph(data), [data]);
  const { nodes, edges, meta } = graph;

  const degree = useMemo(() => buildDegreeMap(edges, nodes), [edges, nodes]);
  const nodeBySlug = useMemo(() => buildNodeIndex(nodes), [nodes]);

  // 默认按关联数降序：枢纽节点优先，避免用户在大图里一路往下翻
  const orderedNodes = useMemo(() => sortByImportance(nodes, degree), [nodes, degree]);
  const filteredNodes = useMemo(() => {
    if (!query) return orderedNodes;
    const q = query.toLowerCase();
    return orderedNodes.filter((n) => `${n.title || ''} ${n.slug}`.toLowerCase().includes(q));
  }, [orderedNodes, query]);

  const visibleNodes = useMemo(() => filteredNodes.slice(0, listLimit), [filteredNodes, listLimit]);

  const relatedSlugs = useMemo(() => (
    selectedNode ? neighborSlugs(edges, selectedNode.slug) : new Set()
  ), [selectedNode, edges]);

  // 选中节点的关联明细（一次算好，不在渲染里反复 filter）
  const selectedNeighbors = useMemo(() => {
    if (!selectedNode) return [];
    return [...neighborSlugs(edges, selectedNode.slug)].map((slug) => ({
      slug,
      title: nodeBySlug.get(slug)?.title || slug
    }));
  }, [selectedNode, edges, nodeBySlug]);

  const errMsg = error ? explainGraphError(error) : '';
  const empty = !loading && !error && isGraphEmpty(graph);
  const emptyInfo = empty ? emptyReason(graph, data) : null;
  // 检索后为空 ≠ 图谱为空
  const noMatch = !loading && !error && !empty && filteredNodes.length === 0;

  const resetAll = () => { setCenter(''); setQuery(''); setSelectedNode(null); setListLimit(LIST_PAGE_SIZE); };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setListLimit(LIST_PAGE_SIZE); }}
            placeholder="过滤节点…"
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {(center || query) && (
          <button
            onClick={resetAll}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm"
          >
            重置
          </button>
        )}
      </div>

      {center && (
        <div className="rounded-xl bg-blue-50 p-2 text-center text-xs text-blue-700">
          <Target className="mx-auto mb-1 h-4 w-4" />
          当前中心：{nodeBySlug.get(center)?.title || center}
        </div>
      )}

      {/* 概览：让用户一眼看到"到底有多少数据" */}
      {!loading && !error && !empty && (
        <div className="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-xs text-gray-500 shadow-sm">
          <span>
            {meta.mode === 'ego' ? '以该节点为中心 · ' : ''}
            {nodes.length} 个节点 · {edges.length} 条关联
            {meta.truncated ? '（服务端已截断）' : ''}
          </span>
          <button onClick={run} className="flex items-center gap-1 font-medium text-blue-600">
            <RotateCw className="h-3 w-3" /> 刷新
          </button>
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载图谱…
        </div>
      )}

      {errMsg && (
        <div className="rounded-2xl bg-red-50 p-3 text-sm text-red-700">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" /> 图谱加载失败
          </div>
          <p className="text-xs leading-relaxed">{errMsg}</p>
          <div className="mt-2 flex gap-2">
            <button
              onClick={run}
              className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-red-700 shadow-sm"
            >
              重试
            </button>
            {center && (
              <button
                onClick={() => { setCenter(''); setSelectedNode(null); }}
                className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm"
              >
                返回全图
              </button>
            )}
          </div>
        </div>
      )}

      {noMatch && (
        <div className="rounded-2xl bg-white p-4 text-sm text-gray-600 shadow-sm">
          没有匹配「{query}」的节点（共 {nodes.length} 个）。图谱本身有数据，换个词试试。
        </div>
      )}

      {!loading && !error && !empty && filteredNodes.length > 0 && (
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">
              <Share2 className="mr-1 inline h-4 w-4" />
              节点关系
              <span className="ml-1 text-xs font-normal text-gray-500">({filteredNodes.length})</span>
            </h4>
            <span className="text-xs text-gray-400">按关联数排序</span>
          </div>

          {filteredNodes.length <= SVG_MAX_NODES && edges.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
              <SimpleGraph
                nodes={filteredNodes}
                edges={edges}
                selectedNode={selectedNode}
                onSelect={setSelectedNode}
              />
            </div>
          )}

          <div className="max-h-[50vh] space-y-1 overflow-y-auto no-scrollbar">
            {visibleNodes.map((node) => {
              const isSelected = selectedNode?.slug === node.slug;
              const isRelated = relatedSlugs.has(node.slug);
              const neighbors = degree.get(node.slug) || 0;
              return (
                <div
                  key={node.slug}
                  onClick={() => setSelectedNode(isSelected ? null : node)}
                  className={clsx(
                    'flex items-center justify-between rounded-xl p-2',
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50',
                    isRelated && !isSelected && 'bg-gray-50'
                  )}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <Circle
                      className="h-3 w-3 shrink-0"
                      style={{ color: TYPE_COLORS[node.page_type] || TYPE_COLORS.other }}
                      fill={TYPE_COLORS[node.page_type] || TYPE_COLORS.other}
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{node.title || node.slug}</p>
                      <p className="truncate text-xs text-gray-500">{node.slug} · {neighbors} 关联</p>
                    </div>
                  </div>
                  {!center && (
                    <button
                      onClick={(e) => { e.stopPropagation(); setCenter(node.slug); setSelectedNode(null); }}
                      className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs text-blue-600 shadow-sm"
                    >
                      展开
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {filteredNodes.length > visibleNodes.length && (
            <button
              onClick={() => setListLimit((n) => n + LIST_PAGE_SIZE)}
              className="mt-2 flex w-full items-center justify-center gap-1 rounded-xl bg-gray-50 py-2 text-xs font-medium text-gray-600"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              再显示 {Math.min(LIST_PAGE_SIZE, filteredNodes.length - visibleNodes.length)} 个
              （还有 {filteredNodes.length - visibleNodes.length} 个）
            </button>
          )}

          {selectedNode && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              <h5 className="mb-2 text-sm font-semibold text-gray-900">
                {selectedNode.title || selectedNode.slug}
              </h5>
              <p className="mb-2 text-xs text-gray-600">
                类型：{selectedNode.page_type || '未知'} · 关联数：{degree.get(selectedNode.slug) || 0}
              </p>
              {selectedNeighbors.length > 0 ? (
                <div className="max-h-40 space-y-1 overflow-y-auto no-scrollbar">
                  {selectedNeighbors.map((nb) => (
                    <button
                      key={nb.slug}
                      onClick={() => { setCenter(nb.slug); setSelectedNode(null); }}
                      className="flex w-full items-center gap-1 text-left text-xs text-gray-600 hover:text-blue-600"
                    >
                      <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" />
                      <span className="truncate">{nb.title}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-400">该节点暂无关联</p>
              )}
            </div>
          )}
        </div>
      )}

      {emptyInfo && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" /> 暂无图谱数据
          </div>
          <p className="text-xs leading-relaxed">{emptyInfo.message}</p>
          {emptyInfo.kind === 'not-built' && (
            <p className="mt-1 text-xs leading-relaxed">
              请在知识库设置中开启「图索引」，并等待 Wiki 生成完成。
            </p>
          )}
          <button
            onClick={run}
            className="mt-2 rounded-lg bg-white px-2 py-1 text-xs font-medium text-amber-800 shadow-sm"
          >
            重新加载
          </button>
        </div>
      )}
    </div>
  );
}

function SimpleGraph({ nodes, edges, selectedNode, onSelect }) {
  const width = 320;
  const height = 200;
  const nodeCount = nodes.length;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(width, height) * 0.35;

  const positions = {};
  nodes.forEach((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(nodeCount, 1) - Math.PI / 2;
    positions[node.slug] = {
      x: centerX + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle)
    };
  });

  // 边太密时全画会糊成一团：先筛掉两端不在可视范围内的，再截断
  const visibleEdges = edges
    .filter((e) => positions[e.source] && positions[e.target])
    .slice(0, SVG_MAX_EDGES);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '200px' }}>
      {visibleEdges.map((e, i) => {
        const s = positions[e.source];
        const t = positions[e.target];
        return (
          <line
            key={`${e.source}-${e.target}-${i}`}
            x1={s.x}
            y1={s.y}
            x2={t.x}
            y2={t.y}
            stroke="#e5e7eb"
            strokeWidth="1"
          />
        );
      })}
      {nodes.map((node) => {
        const pos = positions[node.slug];
        const isSelected = selectedNode?.slug === node.slug;
        return (
          <g
            key={node.slug}
            onClick={() => onSelect(node)}
            style={{ cursor: 'pointer' }}
          >
            <circle
              cx={pos.x}
              cy={pos.y}
              r={isSelected ? 8 : 5}
              fill={TYPE_COLORS[node.page_type] || TYPE_COLORS.other}
              stroke={isSelected ? '#1d4ed8' : '#fff'}
              strokeWidth={isSelected ? 2 : 1}
            />
            <text
              x={pos.x}
              y={pos.y + 14}
              textAnchor="middle"
              fontSize="8"
              fill="#6b7280"
            >
              {(node.title || node.slug).slice(0, 6)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default GraphView;
