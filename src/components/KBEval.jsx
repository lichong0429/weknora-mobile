import { useState } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { KB } from '../api/endpoints.js';
import { Loader2, AlertCircle, Play, BarChart3, FileQuestion } from 'lucide-react';

function KBEval({ kbId, kb }) {
  const [query, setQuery] = useState('');
  const [evalResult, setEvalResult] = useState(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [evalError, setEvalError] = useState(null);

  const s = kb || {};
  const statItems = [
    { label: '文档总数', value: s.knowledge_count ?? 0 },
    { label: '分块总数', value: s.chunk_count ?? 0 },
    { label: '总 Token', value: s.total_tokens ?? '—' },
    { label: '已解析', value: s.parsed_count ?? '—' }
  ].filter((i) => i.value !== '—');

  const handleEval = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setEvalLoading(true);
    setEvalError(null);
    setEvalResult(null);
    try {
      const res = await KB.hybridSearch(kbId, { query_text: query, top_k: 5 });
      setEvalResult(res.data || res);
    } catch (err) {
      setEvalError(err.message || '评估失败');
    } finally {
      setEvalLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
          <BarChart3 className="h-5 w-5 text-blue-600" />
          知识库统计
        </div>
        {statItems.length === 0 && (
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
