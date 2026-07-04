import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Agent } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import { Plus, Bot, Copy, ChevronRight, Loader2, AlertCircle, X } from 'lucide-react';
import { clsx } from 'clsx';

const builtinAvatars = {
  'builtin-quick-answer': '💬',
  'builtin-smart-reasoning': '🧠',
  'builtin-data-analyst': '📊'
};

function AgentList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [mode, setMode] = useState('quick-answer');
  const { data, loading, error, run, setData } = useAsync(() => Agent.list(), []);
  const agents = extractList(data);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const res = await Agent.create({
      name,
      description,
      config: { agent_mode: mode }
    });
    setData({ data: [res.data, ...agents] });
    setShowCreate(false);
    setName('');
    setDescription('');
  };

  const handleCopy = async (id, e) => {
    e.stopPropagation();
    const res = await Agent.copy(id);
    setData({ data: [res.data, ...agents] });
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">智能体</h2>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 rounded-full bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> 新建
        </button>
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
        {agents.map((agent) => (
          <div
            key={agent.id}
            onClick={() => navigate(`/agent/${agent.id}`)}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
          >
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-2xl">
              {agent.avatar || builtinAvatars[agent.id] || <Bot className="h-6 w-6 text-indigo-600" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-gray-900">{agent.name}</h3>
                {agent.is_builtin && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">内置</span>
                )}
              </div>
              <p className="truncate text-xs text-gray-500">{agent.description || '暂无描述'}</p>
              <p className="text-xs text-gray-400">{agent.config?.agent_mode}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => handleCopy(agent.id, e)}
                className="rounded-full p-2 text-gray-400 hover:bg-gray-100"
                aria-label="复制"
              >
                <Copy className="h-4 w-4" />
              </button>
              <ChevronRight className="h-5 w-5 text-gray-400" />
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">新建智能体</h3>
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
                  placeholder="智能体名称"
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
                <label className="mb-1 block text-sm font-medium text-gray-700">模式</label>
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="quick-answer">快速问答</option>
                  <option value="smart-reasoning">智能推理</option>
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
    </div>
  );
}

export default AgentList;
