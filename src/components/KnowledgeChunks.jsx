import { useState, useEffect } from 'react';
import { Knowledge } from '../api/endpoints.js';
import { get } from '../api/client.js';
import { Loader2, AlertCircle, Layers, FileText, ChevronDown, ChevronUp, Bug } from 'lucide-react';
import { clsx } from 'clsx';

function KnowledgeChunks({ knowledgeId, kbId }) {
  const [chunks, setChunks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState(new Set());
  const [loadErrors, setLoadErrors] = useState([]);
  const [showDebug, setShowDebug] = useState(false);

  const loadChunks = async () => {
    setLoading(true);
    setError(null);
    setLoadErrors([]);
    const attempts = [];

    const paths = [
      { source: `/knowledge-bases/${kbId}/knowledge/${knowledgeId}/chunks`, fn: () => Knowledge.chunks(knowledgeId, kbId) },
      { source: `/knowledge/${knowledgeId}/chunks`, fn: () => Knowledge.chunks(knowledgeId) },
      { source: `/knowledge-bases/${kbId}/knowledge/${knowledgeId}/chunk`, fn: () => get(`/knowledge-bases/${kbId}/knowledge/${knowledgeId}/chunk`) },
      { source: `/knowledge/${knowledgeId}/chunk`, fn: () => get(`/knowledge/${knowledgeId}/chunk`) },
    ];

    for (const { source, fn } of paths) {
      try {
        const res = await fn();
        attempts.push({ source, ok: true, status: 'success' });
        const items = extractChunks(res);
        setChunks(items);
        setLoadErrors(attempts);
        setLoading(false);
        return;
      } catch (err) {
        attempts.push({ source, ok: false, error: err.message });
      }
    }

    setLoadErrors(attempts);
    setError('所有分块接口均无法获取数据。');
    setLoading(false);
  };

  useEffect(() => {
    loadChunks();
  }, [knowledgeId, kbId]);

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
        <button onClick={() => setShowDebug((s) => !s)} className="mt-2 flex items-center gap-1 text-xs text-gray-600">
          <Bug className="h-3 w-3" /> {showDebug ? '隐藏调试' : '显示调试'}
        </button>
        {showDebug && (
          <div className="mt-2 rounded-lg bg-gray-900 p-2 text-xs text-gray-100">
            {loadErrors.map((a, i) => (
              <div key={i} className={a.ok ? 'text-green-400' : 'text-red-400'}>
                {a.ok ? '✓' : '✗'} {a.source}: {a.ok ? a.status : a.error}
              </div>
            ))}
          </div>
        )}
        <button onClick={loadChunks} className="mt-2 text-xs text-blue-600">重试</button>
      </div>
    );
  }

  if (chunks.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-gray-400">
        <Layers className="mx-auto mb-2 h-6 w-6 text-gray-300" />
        暂无分块数据
        <button onClick={loadChunks} className="ml-2 text-xs text-blue-600">刷新</button>
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
        <button onClick={loadChunks} className="text-xs text-blue-600">刷新</button>
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

function extractChunks(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  const data = res.data ?? res;
  if (Array.isArray(data)) return data;
  const candidates = [data?.chunks, data?.items, data?.list, data?.results, data?.records, data?.data];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

export default KnowledgeChunks;
