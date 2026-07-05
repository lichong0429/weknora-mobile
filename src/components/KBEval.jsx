import { useState } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { KB } from '../api/endpoints.js';
import { Loader2, AlertCircle, Play, BarChart3, CheckCircle, XCircle, FileQuestion } from 'lucide-react';
import { clsx } from 'clsx';

function KBEval({ kbId }) {
  const { data: stats, loading: statsLoading, error: statsError, run: refreshStats } = useAsync(() => KB.stats(kbId), [kbId]);
  const [query, setQuery] = useState('');
  const [evalResult, setEvalResult] = useState(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState(null);

  const handleEval = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setEvalLoading(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      const res = await KB.eval(kbId, { query_text: query, top_k: 5 });
      setEvalResult(res.data || res);
    } catch (err) {
      setEvalError(err.message || '评估失败');
    } finally {
      setEvalLoading(false);
    }
  };

  const statItems = (() => {
    if (!stats) return [];
    const s = stats.data || stats;
    const items = [];
    if (s.knowledge_count !== undefined) items.push({ label: '文档总数', value: s.knowledge_count });
    if (s.chunk_count !== undefined) items.push({ label: '分块总数', value: s.chunk_count });
    if (s.total_tokens !== undefined) items.push({ label: 'Token 总数', value: s.total_tokens });
    if (s.parsed_count !== undefined) items.push({ label: '已解析', value: s.parsed_count });
    if (s.failed_count !== undefined) items.push({ label: '解析失败', value: s.failed_count });
    if (s.pending_count !== undefined) items.push({ label: '待解析', value: s.pending_count });
    return items;
  })();

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-gray-900">
            <BarChart3 className="h-5 w-5 text-blue-600" />
            知识库统计
          </div>
          <button onClick={refreshStats} className="text-xs text-blue-600">刷新</button>
        </div>
        {statsLoading && (
          <div className="py-4 text-center text-sm text-gray-500">
            <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 加载统计…
          </div>
        )}
        {statsError && (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-center gap-1 font-medium">
              <AlertCircle className="h-4 w-4" /> 统计加载失败
            </div>
            <p className="text-xs">{statsError}</p>
          </div>
        )}
        {!statsLoading && !statsError && statItems.length === 0 && (
          <div className="py-4 text-center text-sm text-gray-400">暂无统计信息</div>
        )}
        <div className="grid grid-cols-2 gap-2">
          {statItems.map((item) => (
            <div key={item.label} className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">{item.label}</p>
              <p className="text-lg font-semibold text-gray-900">{item.value ?? 0}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
          <FileQuestion className="h-5 w-5 text-blue-600" />
          检索评估
        </div>
        <p className="mb-3 text-xs text-gray-500">输入一个测试问题，评估该知识库的检索召回质量。</p>
        <form onSubmit={handleEval} className="mb-3 flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入测试问题…"
            className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={evalLoading}
            className="flex items-center gap-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {evalLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </button>
        </form>

        {evalError && (
          <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <div className="flex items-center gap-1 font-medium">
              <AlertCircle className="h-4 w-4" /> 评估失败
            </div>
            <p className="text-xs">{evalError}</p>
          </div>
        )}

        {evalResult && (
          <div className="space-y-2">
            <div className="rounded-xl bg-gray-50 p-3">
              <p className="text-xs text-gray-500">评估结果</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs text-gray-700">
                {JSON.stringify(evalResult, null, 2)}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default KBEval;
