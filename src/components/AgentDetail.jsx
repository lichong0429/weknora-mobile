import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Agent, Model, KB, Session } from '../api/endpoints.js';
import { Loader2, AlertCircle, Save, Trash2, Bot, ArrowLeft, Cpu, BookOpen, MessageSquare } from 'lucide-react';

function AgentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => Agent.detail(id), [id]);
  const { data: modelRes } = useAsync(() => Model.list(), []);
  const { data: kbRes } = useAsync(() => KB.list(), []);
  const agent = data?.data;
  const models = modelRes?.data || [];
  const kbs = kbRes?.data || [];

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState('');
  const [mode, setMode] = useState('quick-answer');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [webSearch, setWebSearch] = useState(false);
  const [multiTurn, setMultiTurn] = useState(true);
  const [modelId, setModelId] = useState('');
  const [selectedKBs, setSelectedKBs] = useState([]);
  const [summaryModelId, setSummaryModelId] = useState('');
  const [rerankModelId, setRerankModelId] = useState('');
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
      setModelId(agent.config?.model_id || agent.model_id || '');
      setSummaryModelId(agent.config?.summary_model_id || '');
      setRerankModelId(agent.config?.rerank_model_id || '');
      const kbIds = agent.config?.knowledge_base_ids || agent.knowledge_base_ids || [];
      setSelectedKBs(Array.isArray(kbIds) ? kbIds : []);
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
        knowledge_base_ids: selectedKBs,
        config: {
          agent_mode: mode,
          system_prompt: systemPrompt,
          temperature,
          max_completion_tokens: maxTokens,
          web_search_enabled: webSearch,
          multi_turn_enabled: multiTurn,
          model_id: modelId || undefined,
          summary_model_id: summaryModelId || undefined,
          rerank_model_id: rerankModelId || undefined,
          knowledge_base_ids: selectedKBs
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

  const handleTestChat = async () => {
    try {
      const res = await Session.create({ title: agent?.name || '测试会话' });
      navigate(`/session/${res.data.id}`, { state: { agent_id: id } });
    } catch (err) {
      alert('创建测试会话失败：' + (err.message || '未知错误'));
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
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-gray-900">{agent.name}</h2>
            <p className="text-xs text-gray-500">{agent.is_builtin ? '内置' : '自定义'} · {agent.config?.agent_mode}</p>
          </div>
        </div>
        <button
          onClick={handleTestChat}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 py-2.5 text-sm font-medium text-white shadow-sm hover:from-indigo-700 hover:to-violet-700 active:scale-95 transition-transform"
        >
          <MessageSquare className="h-4 w-4" /> 测试对话
        </button>
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
          <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
            <Cpu className="h-3.5 w-3.5" /> 模型
          </label>
          <select
            value={modelId}
            onChange={(e) => setModelId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">使用知识库默认模型</option>
            {models.filter(m => m.type === 'KnowledgeQA').map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
            <Cpu className="h-3.5 w-3.5" /> 摘要模型（可选）
          </label>
          <select
            value={summaryModelId}
            onChange={(e) => setSummaryModelId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">默认</option>
            {models.filter(m => m.type === 'KnowledgeQA').map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
            <Cpu className="h-3.5 w-3.5" /> Rerank 模型（可选）
          </label>
          <select
            value={rerankModelId}
            onChange={(e) => setRerankModelId(e.target.value)}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">默认</option>
            {models.filter(m => m.type === 'Rerank').map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
            <BookOpen className="h-3.5 w-3.5" /> 关联知识库
          </label>
          <div className="max-h-32 overflow-y-auto rounded-xl border border-gray-200 bg-gray-50 p-2">
            {kbs.length === 0 && <p className="text-xs text-gray-400">暂无知识库</p>}
            {kbs.map((kb) => (
              <label key={kb.id} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={selectedKBs.includes(kb.id)}
                  onChange={() => {
                    setSelectedKBs((prev) =>
                      prev.includes(kb.id) ? prev.filter((x) => x !== kb.id) : [...prev, kb.id]
                    );
                  }}
                  className="h-4 w-4 text-blue-600 rounded"
                />
                <span className="truncate">{kb.name}</span>
              </label>
            ))}
          </div>
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
