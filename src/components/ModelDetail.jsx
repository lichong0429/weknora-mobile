import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Model } from '../api/endpoints.js';
import {
  Loader2, AlertCircle, Save, Trash2, X, Bot, Hash, Layers, Eye, Mic, Cpu
} from 'lucide-react';
import { clsx } from 'clsx';

const typeMeta = {
  KnowledgeQA: { label: '对话', icon: Bot, color: 'bg-blue-50 text-blue-600' },
  Embedding: { label: 'Embedding', icon: Hash, color: 'bg-emerald-50 text-emerald-600' },
  Rerank: { label: 'Rerank', icon: Layers, color: 'bg-amber-50 text-amber-600' },
  VLLM: { label: '视觉', icon: Eye, color: 'bg-purple-50 text-purple-600' },
  ASR: { label: '语音', icon: Mic, color: 'bg-rose-50 text-rose-600' }
};

function ModelDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => Model.detail(id), [id]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const model = data?.data;

  useEffect(() => {
    if (model) {
      setForm({
        name: model.name || '',
        description: model.description || '',
        type: model.type || 'KnowledgeQA',
        source: model.source || 'remote',
        parameters: {
          base_url: model.parameters?.base_url || '',
          api_key: '',
          provider: model.parameters?.provider || 'generic',
          embedding_parameters: {
            dimension: model.parameters?.embedding_parameters?.dimension || 1024,
            truncate_prompt_tokens: 0
          }
        }
      });
    }
  }, [model]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = {
        name: form.name,
        description: form.description,
        type: form.type,
        source: form.source,
        parameters: { ...form.parameters }
      };
      if (!form.parameters.api_key) delete body.parameters.api_key;
      await Model.update(id, body);
      alert('保存成功');
      run();
    } catch (err) {
      alert(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('确定删除该模型？')) return;
    try {
      await Model.remove(id);
      navigate('/models');
    } catch (err) {
      alert(err.message || '删除失败');
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
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      </div>
    );
  }

  if (!form) return null;

  const meta = typeMeta[model.type] || { label: model.type, icon: Cpu, color: 'bg-gray-100 text-gray-600' };
  const Icon = meta.icon;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <div className={clsx('rounded-xl p-2', meta.color)}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-gray-900">{model.name}</h2>
          <p className="text-xs text-gray-500">{meta.label} · {model.source === 'local' ? '本地' : '远程'}</p>
        </div>
        <button
          onClick={handleRemove}
          className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">类型</label>
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value })}
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
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
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
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        {form.source === 'remote' && (
          <>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">服务商</label>
              <select
                value={form.parameters.provider}
                onChange={(e) => setForm({ ...form, parameters: { ...form.parameters, provider: e.target.value } })}
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
                value={form.parameters.base_url}
                onChange={(e) => setForm({ ...form, parameters: { ...form.parameters, base_url: e.target.value } })}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">API Key（留空则保留原值）</label>
              <input
                type="password"
                value={form.parameters.api_key}
                onChange={(e) => setForm({ ...form, parameters: { ...form.parameters, api_key: e.target.value } })}
                placeholder="******"
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}
        {form.type === 'Embedding' && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">向量维度</label>
            <input
              type="number"
              value={form.parameters.embedding_parameters.dimension}
              onChange={(e) => setForm({
                ...form,
                parameters: {
                  ...form.parameters,
                  embedding_parameters: { ...form.parameters.embedding_parameters, dimension: parseInt(e.target.value, 10) || 0 }
                }
              })}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}
        <div className="pt-2">
          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-2 text-sm font-semibold text-gray-900">状态</h3>
        <div className="space-y-1 text-sm text-gray-600">
          <p>状态：{model.status || 'active'}</p>
          {model.is_default && <p>默认模型：是</p>}
          {model.is_builtin && <p>内置模型：是</p>}
          <p>创建时间：{model.created_at ? new Date(model.created_at).toLocaleString() : '-'}</p>
        </div>
      </div>
    </div>
  );
}

export default ModelDetail;
