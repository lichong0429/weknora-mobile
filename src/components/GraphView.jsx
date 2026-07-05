import { useState } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { Wiki } from '../api/endpoints.js';
import {
  Share2, Loader2, AlertCircle, Search, Target, Circle, ArrowRight
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

function GraphView({ kbId }) {
  const [center, setCenter] = useState('');
  const [query, setQuery] = useState('');
  const [selectedNode, setSelectedNode] = useState(null);

  const { data, loading, error, run } = useAsync(
    () => Wiki.getGraph(kbId, center ? { mode: 'ego', center, depth: 2 } : { mode: 'overview' }),
    [kbId, center]
  );

  const graph = data?.data || { nodes: [], edges: [], meta: {} };
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  const filteredNodes = query
    ? nodes.filter((n) => (n.title || n.slug).toLowerCase().includes(query.toLowerCase()))
    : nodes;

  const nodeBySlug = Object.fromEntries(nodes.map((n) => [n.slug, n]));
  const relatedSlugs = selectedNode
    ? new Set(edges.filter((e) => e.source === selectedNode.slug || e.target === selectedNode.slug)
      .flatMap((e) => [e.source, e.target]))
    : new Set();

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="过滤节点…"
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {center && (
          <button
            onClick={() => setCenter('')}
            className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm"
          >
            重置
          </button>
        )}
      </div>

      {center && (
        <div className="rounded-xl bg-blue-50 p-2 text-center text-xs text-blue-700">
          <Target className="mx-auto mb-1 h-4 w-4" />
          当前中心：{nodeBySlug[center]?.title || center}
        </div>
      )}

      {loading && (
        <div className="py-8 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载图谱…
        </div>
      )}
      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</div>
      )}

      {!loading && nodes.length > 0 && (
        <div className="rounded-2xl bg-white p-3 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h4 className="text-sm font-semibold text-gray-900">
              <Share2 className="mr-1 inline h-4 w-4" />
              节点关系
              <span className="ml-1 text-xs font-normal text-gray-500">({filteredNodes.length})</span>
            </h4>
            <button
              onClick={run}
              className="text-xs text-blue-600"
            >
              刷新
            </button>
          </div>

          {/* Simple SVG mini-graph for top 30 nodes */}
          {filteredNodes.length <= 30 && edges.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
              <SimpleGraph
                nodes={filteredNodes}
                edges={edges}
                selectedNode={selectedNode}
                onSelect={setSelectedNode}
              />
            </div>
          )}

          <div className="space-y-1 max-h-[50vh] overflow-y-auto no-scrollbar">
            {filteredNodes.map((node) => {
              const isSelected = selectedNode?.slug === node.slug;
              const isRelated = relatedSlugs.has(node.slug);
              const neighbors = edges.filter((e) => e.source === node.slug || e.target === node.slug).length;
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
                  <div className="flex items-center gap-2 min-w-0">
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
                      onClick={(e) => { e.stopPropagation(); setCenter(node.slug); }}
                      className="shrink-0 rounded-lg bg-white px-2 py-1 text-xs text-blue-600 shadow-sm"
                    >
                      展开
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {selectedNode && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              <h5 className="mb-2 text-sm font-semibold text-gray-900">{selectedNode.title || selectedNode.slug}</h5>
              <p className="text-xs text-gray-600 mb-2">类型：{selectedNode.page_type} · 关联数：{selectedNode.link_count}</p>
              <div className="space-y-1">
                {edges
                  .filter((e) => e.source === selectedNode.slug || e.target === selectedNode.slug)
                  .map((e, i) => {
                    const other = e.source === selectedNode.slug ? e.target : e.source;
                    const otherNode = nodeBySlug[other];
                    return (
                      <div key={i} className="flex items-center gap-1 text-xs text-gray-600">
                        <ArrowRight className="h-3 w-3 text-gray-400" />
                        <span>{otherNode?.title || other}</span>
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {!loading && !error && nodes.length === 0 && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" /> 暂无图谱数据
          </div>
          <p className="text-xs leading-relaxed">
            该知识库未启用图索引或尚未生成 Wiki。请在知识库设置中开启「图索引」。
          </p>
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

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height: '200px' }}>
      {edges.map((e, i) => {
        const s = positions[e.source];
        const t = positions[e.target];
        if (!s || !t) return null;
        return (
          <line
            key={i}
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
