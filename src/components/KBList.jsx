import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { useConfig } from '../contexts/ConfigContext.jsx';
import { KB } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import { Plus, Database, Pin, ChevronRight, Loader2, AlertCircle, X, Wrench, RefreshCw, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import KBCopyMoveModal from './KBCopyMoveModal.jsx';

function KBList() {
  const navigate = useNavigate();
  const { config } = useConfig();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('document');
  const [activeKb, setActiveKb] = useState(null);
  const { data, loading, error, run, setData } = useAsync(
    () => KB.list(),
    [config.baseUrl, config.apiKey, config.useProxy]
  );

  const kbs = extractList(data);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await KB.create({ name, description, type });
    setData({ data: [res.data, ...kbs] });
    setShowCreate(false);
    setName('');
    setDescription('');
  };

  const togglePin = async (kb, e) => {
    e.stopPropagation();
    const res = await KB.pin(kb.id);
    setData({
      data: kbs.map((k) => (k.id === kb.id ? { ...k, is_pinned: res.data.is_pinned, pinned_at: res.data.pinned_at } : k))
    });
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">知识库</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1 rounded-full bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-100 disabled:opacity-50"
          >
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} /> 刷新
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" /> 新建
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      <div className="space-y-3">
        {kbs.map((kb) => (
          <div
            key={kb.id}
            onClick={() => navigate(`/kb/${kb.id}`)}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
          >
            <div className={clsx('rounded-xl p-2', kb.type === 'faq' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600')}>
              <Database className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-gray-900">{kb.name}</h3>
                {kb.is_pinned && <Pin className="h-3.5 w-3.5 fill-blue-600 text-blue-600" />}
              </div>
              <p className="truncate text-xs text-gray-500">
                {kb.description || '暂无描述'} · {kb.knowledge_count || 0} 文档
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); setActiveKb(kb); }}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100"
                aria-label="复制/移动"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => togglePin(kb, e)}
                className={clsx(
                  'rounded-full p-2',
                  kb.is_pinned ? 'bg-blue-100 text-blue-600' : 'hover:bg-gray-100 text-gray-400'
                )}
                aria-label={kb.is_pinned ? '取消置顶' : '置顶'}
              >
                <Pin className="h-4 w-4" />
              </button>
              <ChevronRight className="h-5 w-5 text-gray-400" />
            </div>
          </div>
        ))}
      </div>

      {!loading && !error && kbs.length === 0 && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
          <div className="mb-2 flex items-center gap-2 font-semibold">
            <AlertCircle className="h-4 w-4" /> 暂无知识库
          </div>
          <p className="mb-2 text-xs leading-relaxed">
            后端返回了空列表。如果网页端有知识库，通常是 API Key 没有对应到正确的租户。
          </p>
          <button
            onClick={() => navigate('/diagnostics')}
            className="flex items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-amber-800 shadow-sm hover:bg-amber-100"
          >
            <Wrench className="h-3.5 w-3.5" /> 去诊断页排查
          </button>
        </div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">新建知识库</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="知识库名称"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">描述</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                  placeholder="可选描述"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">类型</label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="document">文档</option>
                  <option value="faq">FAQ</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                创建
              </button>
            </form>
          </div>
        </div>
      )}
      {activeKb && (
        <KBCopyMoveModal
          kb={activeKb}
          onClose={() => setActiveKb(null)}
          onSuccess={() => { setActiveKb(null); run(); }}
        />
      )}
    </div>
  );
}

export default KBList;
