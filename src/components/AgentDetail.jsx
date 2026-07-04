import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Agent } from '../api/endpoints.js';
import { Loader2, AlertCircle, Save, Trash2, Bot, ArrowLeft } from 'lucide-react';

function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => Agent.detail(id), [id]);
  const agent = data?.data;

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('');
  const [mode, setMode] = useState('quick-answer');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [webSearch, setWebSearch] = useState(false);
  const [multiTurn, setMultiTurn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (agent) {
      setName(agent.name || '');
      setDescription(agent.description || '');
      setAvatar(agent.avatar || '');
      setMode(agent.config?.agent_mode || 'quick-answer');
      setSystemPrompt(agent.config?.system_prompt || '');
      setTemperature(agent.config?.temperature ?? 0.7);
      setMaxTokens(agent.config?.max_completion_tokens ?? 2048);
      setWebSearch(agent.config?.web_search_enabled ?? false);
      setMultiTurn(agent.config?.multi_turn_enabled ?? true);
    }
  }, [agent]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await Agent.update(id, {
        name,
        description,
        avatar,
        config: {
          agent_mode: mode,
          system_prompt: systemPrompt,
          temperature,
          max_completion_tokens: maxTokens,
          web_search_enabled: webSearch,
          multi_turn_enabled: multiTurn
        }
      });
      run();
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (agent?.is_builtin) {
      alert('内置智能体不能删除');
      return;
    }
    if (!window.confirm('确定删除该智能体？')) return;
    setDeleting(true);
    try {
      await Agent.remove(id);
      navigate('/agents');
    } catch (err) {
      alert(err.message);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </div>
      </div>
    );
  }

  if (!agent) return null;

  return (
    <div className="p-4">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <button onClick={() => navigate(-1)} className="mb-3 flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> 返回
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-indigo-50 text-2xl">
            {agent.avatar || <Bot className="h-7 w-7 text-indigo-600" />}
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{agent.name}</h2>
            <p className="text-xs text-gray-500">{agent.is_builtin ? '内置' : '自定义'} · {agent.config?.agent_mode}</p>
          </div>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">描述</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">头像（emoji 或图标）</label>
          <input
            value={avatar}
            onChange={(e) => setAvatar(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
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
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">系统提示词</label>
          <textarea
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            rows={5}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">Temperature: {temperature}</label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={temperature}
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
            className="w-full"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">最大 Token: {maxTokens}</label>
          <input
            type="number"
            value={maxTokens}
            onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span className="text-sm font-medium text-gray-700">启用网络搜索</span>
          <input
            type="checkbox"
            checked={webSearch}
            onChange={(e) => setWebSearch(e.target.checked)}
            className="h-5 w-5 text-blue-600"
          />
        </div>
        <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <span className="text-sm font-medium text-gray-700">启用多轮对话</span>
          <input
            type="checkbox"
            checked={multiTurn}
            onChange={(e) => setMultiTurn(e.target.checked)}
            className="h-5 w-5 text-blue-600"
          />
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={saving || agent.is_builtin}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? '保存中' : '保存'}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting || agent.is_builtin}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-red-50 py-2.5 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" /> {deleting ? '删除中' : '删除'}
          </button>
        </div>
        {agent.is_builtin && (
          <p className="text-center text-xs text-gray-500">内置智能体不可编辑或删除，可复制后修改副本。</p>
        )}
      </form>
    </div>
  );
}

export default AgentDetail;
