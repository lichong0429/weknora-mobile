import { useState, useEffect } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { Knowledge } from '../api/endpoints.js';
import { Loader2, AlertCircle, Layers, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';

function KnowledgeChunks({ knowledgeId }) {
  const { data, loading, error, run } = useAsync(() => Knowledge.chunks(knowledgeId), [knowledgeId]);
  const [expanded, setExpanded] = useState(new Set());

  const chunks = (() => {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.data)) return data.data;
    if (Array.isArray(data.items)) return data.items;
    if (Array.isArray(data.list)) return data.list;
    if (Array.isArray(data.chunks)) return data.chunks;
    return [];
  })();

  const toggle = (idx) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-gray-500">
        <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载分块…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
        <div className="mb-1 flex items-center gap-1 font-medium">
          <AlertCircle className="h-4 w-4" /> 分块加载失败
        </div>
        <p className="text-xs">{error}</p>
        <button onClick={run} className="mt-2 text-xs text-blue-600">重试</button>
      </div>
    );
  }

  if (chunks.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        <Layers className="mx-auto mb-2 h-6 w-6 text-gray-300" />
        暂无分块数据
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
          <Layers className="h-4 w-4 text-blue-600" />
          分块 ({chunks.length})
        </div>
        <button onClick={run} className="text-xs text-blue-600">刷新</button>
      </div>
      {chunks.map((chunk, idx) => {
        const content = chunk.content || chunk.text || chunk.chunk_text || chunk.body || '';
        const meta = chunk.metadata || {};
        const isOpen = expanded.has(idx);
        return (
          <div key={chunk.id || idx} className="rounded-2xl bg-white p-3 shadow-sm">
            <button
              onClick={() => toggle(idx)}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-gray-400" />
                <span className="text-sm font-medium text-gray-900">
                  分块 {chunk.index ?? idx + 1}
                </span>
              </div>
              {isOpen ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
            </button>
            <div className={clsx('mt-2 text-sm text-gray-700', !isOpen && 'line-clamp-3')}>
              {content || '无内容'}
            </div>
            {isOpen && (
              <div className="mt-2 space-y-1 border-t border-gray-100 pt-2 text-xs text-gray-500">
                {chunk.tokens !== undefined && <p>tokens: {chunk.tokens}</p>}
                {chunk.char_count !== undefined && <p>字符: {chunk.char_count}</p>}
                {meta.source && <p>来源: {meta.source}</p>}
                {meta.page && <p>页码: {meta.page}</p>}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default KnowledgeChunks;
