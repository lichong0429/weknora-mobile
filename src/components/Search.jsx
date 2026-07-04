import { useState } from 'react';
import { Search as SearchIcon, Loader2, BookOpen, AlertCircle, ChevronDown } from 'lucide-react';
import { useAsync } from '../hooks/useApi.js';
import { Search as SearchAPI, KB } from '../api/endpoints.js';

function Search() {
  const { data: kbRes } = useAsync(() => KB.list(), []);
  const kbs = kbRes?.data || [];

  const [query, setQuery] = useState('');
  const [selectedKBs, setSelectedKBs] = useState([]);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  const toggleKB = (id) => {
    setSelectedKBs((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const payload = { query: query.trim() };
      if (selectedKBs.length) {
        payload.knowledge_base_ids = selectedKBs;
      } else if (kbs.length) {
        payload.knowledge_base_ids = kbs.map((k) => k.id);
      }
      const res = await SearchAPI.knowledge(payload);
      setResults(res.data || []);
    } catch (err) {
      setError(err.message || '搜索失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">语义搜索</h2>

      <form onSubmit={handleSearch} className="mb-4 space-y-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入关键词或问题…"
            className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
          </button>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-gray-700">选择知识库（默认全选）</p>
          <div className="flex flex-wrap gap-2">
            {kbs.map((kb) => (
              <button
                key={kb.id}
                type="button"
                onClick={() => toggleKB(kb.id)}
                className={
                  selectedKBs.includes(kb.id)
                    ? 'rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700'
                    : 'rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600'
                }
              >
                {kb.name}
              </button>
            ))}
          </div>
        </div>
      </form>

      {error && (
        <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mr-1 inline h-4 w-4" /> {error}
        </div>
      )}

      {results && results.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-500">未找到相关结果</div>
      )}

      <div className="space-y-3">
        {results?.map((item, idx) => {
          const isExpanded = expanded[item.id];
          return (
            <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BookOpen className="h-4 w-4 text-blue-600" />
                  <span className="text-sm font-semibold text-gray-900">{item.knowledge_title}</span>
                </div>
                <span className="text-xs text-gray-400">score {item.score?.toFixed(3)}</span>
              </div>
              <p className={isExpanded ? 'text-sm text-gray-700' : 'line-clamp-3 text-sm text-gray-700'}>
                {item.content}
              </p>
              {item.content?.length > 120 && (
                <button
                  onClick={() => setExpanded((prev) => ({ ...prev, [item.id]: !prev[item.id] }))}
                  className="mt-2 flex items-center text-xs text-blue-600"
                >
                  {isExpanded ? '收起' : '展开'} <ChevronDown className={isExpanded ? 'rotate-180' : ''} />
                </button>
              )}
              <p className="mt-2 text-xs text-gray-400">{item.knowledge_filename}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Search;
