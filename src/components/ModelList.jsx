import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Model } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import {
  Plus, Cpu, ChevronRight, Loader2, AlertCircle, X,
  Bot, Hash, Layers, Eye, Mic
} from 'lucide-react';
import { clsx } from 'clsx';

const typeMeta = {
  KnowledgeQA: { label: '对话', icon: Bot, color: 'bg-blue-50 text-blue-600' },
  Embedding: { label: 'Embedding', icon: Hash, color: 'bg-emerald-50 text-emerald-600' },
  Rerank: { label: 'Rerank', icon: Layers, color: 'bg-amber-50 text-amber-600' },
  VLLM: { label: '视觉', icon: Eye, color: 'bg-purple-50 text-purple-600' },
  ASR: { label: '语音', icon: Mic, color: 'bg-rose-50 text-rose-600' }
};

function ModelList() {
  const navigate = useNavigate();
  const { data, loading, error, run, setData } = useAsync(() => Model.list(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState('KnowledgeQA');
  const [source, setSource] = useState('remote');
  const [description, setDescription] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('generic');
  const [dimension, setDimension] = useState('1024');
  const [creating, setCreating] = useState(false);

  const models = extractList(data);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const body = {
      name,
      type,
      source,
      description,
      parameters: {
        base_url: baseUrl,
        api_key: apiKey,
        provider
      }
    };
    if (type === 'Embedding') {
      body.parameters.embedding_parameters = {
        dimension: parseInt(dimension, 10) || 1024,
        truncate_prompt_tokens: 0
      };
    }
    setCreating(true);
    try {
      const res = await Model.create(body);
      setData({ data: [res.data, ...models] });
      setShowCreate(false);
      setName('');
      setDescription('');
      setBaseUrl('');
      setApiKey('');
      setProvider('generic');
      setDimension('1024');
    } catch (err) {
      alert(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (id) => {
    if (!confirm('确定删除该模型？')) return;
    try {
      await Model.remove(id);
      setData({ data: models.filter((m) => m.id !== id) });
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">模型</h2>
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
        {models.map((model) => {
          const meta = typeMeta[model.type] || { label: model.type, icon: Cpu, color: 'bg-gray-100 text-gray-600' };
          const Icon = meta.icon;
          return (
            <div
              key={model.id}
              onClick={() => navigate(`/model/${model.id}`)}
              className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
            >
              <div className={clsx('rounded-xl p-2', meta.color)}>
                <Icon className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="truncate font-semibold text-gray-900">{model.name}</h3>
                  {model.is_default && (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">默认</span>
                  )}
                  {model.is_builtin && (
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">内置</span>
                  )}
                </div>
                <p className="truncate text-xs text-gray-500">
                  {meta.label} · {model.source === 'local' ? '本地' : '远程'} · {model.description || '无描述'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(model.id); }}
                  className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
                <ChevronRight className="h-5 w-5 text-gray-400" />
              </div>
            </div>
          );
        })}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">新建模型</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">模型名称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="如 qwen-plus"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">类型</label>
                  <select
                    value={type}
                    onChange={(e) => setType(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="KnowledgeQA">对话</option>
                    <option value="Embedding">Embedding</option>
                    <option value="Rerank">Rerank</option>
                    <option value="VLLM">视觉</option>
                    <option value="ASR">语音</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">来源</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                  >
                    <option value="remote">远程 API</option>
                    <option value="local">本地 Ollama</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">描述</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="可选"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
              {source === 'remote' && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">服务商</label>
                    <select
                      value={provider}
                      onChange={(e) => setProvider(e.target.value)}
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                    >
                      <option value="generic">通用 OpenAI 兼容</option>
                      <option value="openai">OpenAI</option>
                      <option value="aliyun">阿里云 DashScope</option>
                      <option value="zhipu">智谱 BigModel</option>
                      <option value="deepseek">DeepSeek</option>
                      <option value="siliconflow">硅基流动</option>
                      <option value="moonshot">Moonshot</option>
                      <option value="hunyuan">腾讯混元</option>
                      <option value="volcengine">火山引擎</option>
                      <option value="jina">Jina</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">Base URL</label>
                    <input
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://..."
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-gray-700">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}
              {type === 'Embedding' && (
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">向量维度</label>
                  <input
                    type="number"
                    value={dimension}
                    onChange={(e) => setDimension(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCreate(false)}
                  className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  {creating ? '创建中…' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default ModelList;
