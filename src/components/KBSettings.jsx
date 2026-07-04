import { useState, useEffect } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { KB, Model } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import {
  Save, Loader2, AlertCircle, Cpu, Database, BookOpen,
  Sparkles, Image as ImageIcon, FileText, Search, LayoutGrid,
  ChevronDown, Check
} from 'lucide-react';
import { clsx } from 'clsx';

const GRANULARITIES = [
  { key: 'focus', label: '聚焦', desc: '只抽取核心实体与概念' },
  { key: 'standard', label: '标准', desc: '主角 + 次要实体，跳过通用名词' },
  { key: 'detailed', label: '详尽', desc: '尽可能抽取所有实体与关系' }
];

function Section({ title, icon: Icon, children }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ModelSelector({ label, value, onChange, models, fallbackId, type }) {
  const filtered = models.filter((m) => m.type === type);
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {filtered.length > 0 ? (
        <select
          value={value || ''}
          onChange={(e) => onChange(e.target.value || null)}
          className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          <option value="">不指定</option>
          {filtered.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name || m.model_name || m.id}
            </option>
          ))}
        </select>
      ) : (
        <div className="space-y-1">
          <input
            value={value || fallbackId || ''}
            onChange={(e) => onChange(e.target.value || null)}
            placeholder={`可输入模型 ID${fallbackId ? `（当前：${fallbackId}）` : ''}`}
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500">未加载到 {type} 模型，可手动填写模型 ID</p>
        </div>
      )}
    </div>
  );
}

function KBSettings({ kb, onUpdated }) {
  const { data: modelsRes, loading: modelsLoading, error: modelsError } = useAsync(() => Model.list(), []);
  const models = extractList(modelsRes);

  // Basic
  const [name, setName] = useState(kb.name || '');
  const [description, setDescription] = useState(kb.description || '');
  const [type, setType] = useState(kb.type || 'document');

  // Models
  const [embeddingModelId, setEmbeddingModelId] = useState(kb.embedding_model_id || '');
  const [summaryModelId, setSummaryModelId] = useState(kb.summary_model_id || '');
  const [vlmEnabled, setVlmEnabled] = useState(kb.vlm_config?.enabled || false);
  const [vlmModelId, setVlmModelId] = useState(kb.vlm_config?.model_id || '');

  // Indexing strategy
  const [vectorEnabled, setVectorEnabled] = useState(kb.indexing_strategy?.vector_enabled ?? true);
  const [keywordEnabled, setKeywordEnabled] = useState(kb.indexing_strategy?.keyword_enabled ?? true);
  const [wikiEnabled, setWikiEnabled] = useState(kb.indexing_strategy?.wiki_enabled ?? false);
  const [graphEnabled, setGraphEnabled] = useState(kb.indexing_strategy?.graph_enabled ?? false);

  // Wiki
  const [granularity, setGranularity] = useState(kb.wiki_config?.extraction_granularity || 'standard');
  const [wikiSynthModelId, setWikiSynthModelId] = useState(kb.wiki_config?.synthesis_model_id || '');

  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState(null);

  useEffect(() => {
    setName(kb.name || '');
    setDescription(kb.description || '');
    setType(kb.type || 'document');
    setEmbeddingModelId(kb.embedding_model_id || '');
    setSummaryModelId(kb.summary_model_id || '');
    setVlmEnabled(kb.vlm_config?.enabled || false);
    setVlmModelId(kb.vlm_config?.model_id || '');
    setVectorEnabled(kb.indexing_strategy?.vector_enabled ?? true);
    setKeywordEnabled(kb.indexing_strategy?.keyword_enabled ?? true);
    setWikiEnabled(kb.indexing_strategy?.wiki_enabled ?? false);
    setGraphEnabled(kb.indexing_strategy?.graph_enabled ?? false);
    setGranularity(kb.wiki_config?.extraction_granularity || 'standard');
    setWikiSynthModelId(kb.wiki_config?.synthesis_model_id || '');
  }, [kb]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const body = {
        name,
        description,
        type,
        embedding_model_id: embeddingModelId || undefined,
        summary_model_id: summaryModelId || undefined,
        vlm_config: {
          enabled: vlmEnabled,
          model_id: vlmModelId || undefined
        },
        indexing_strategy: {
          vector_enabled: vectorEnabled,
          keyword_enabled: keywordEnabled,
          wiki_enabled: wikiEnabled,
          graph_enabled: graphEnabled
        },
        wiki_config: {
          extraction_granularity: granularity,
          synthesis_model_id: wikiSynthModelId || undefined
        }
      };
      await KB.update(kb.id, body);
      setMessage({ type: 'success', text: '保存成功' });
      onUpdated();
    } catch (err) {
      setMessage({ type: 'error', text: err.message || '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Section title="基本信息" icon={FileText}>
        <div className="space-y-4">
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
            <label className="mb-1 block text-sm font-medium text-gray-700">知识库 ID</label>
            <input
              value={kb.id}
              readOnly
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-500"
            />
            <p className="mt-1 text-xs text-gray-500">API 集成时使用此 ID</p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">知识库类型</label>
            <div className="flex gap-2">
              {[
                { key: 'document', label: '文档', desc: '支持文件解析与分块' },
                { key: 'faq', label: '问答', desc: '适合结构化问答数据' }
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setType(t.key)}
                  className={clsx(
                    'flex-1 rounded-xl border p-3 text-left transition-colors',
                    type === t.key
                      ? 'border-blue-500 bg-blue-50 text-blue-700'
                      : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                  )}
                >
                  <p className="font-medium">{t.label}</p>
                  <p className="text-xs text-gray-500">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </Section>

      <Section title="模型配置" icon={Cpu}>
        <div className="space-y-4">
          {modelsLoading && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载模型列表…
            </div>
          )}
          {modelsError && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              加载模型失败：{modelsError}
            </div>
          )}
          <ModelSelector
            label="Embedding 模型"
            value={embeddingModelId}
            onChange={setEmbeddingModelId}
            models={models}
            fallbackId={kb.embedding_model_id}
            type="Embedding"
          />
          <ModelSelector
            label="摘要 / 合成模型"
            value={summaryModelId}
            onChange={setSummaryModelId}
            models={models}
            fallbackId={kb.summary_model_id}
            type="KnowledgeQA"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Wiki 合成模型</label>
            <ModelSelector
              label=""
              value={wikiSynthModelId}
              onChange={setWikiSynthModelId}
              models={models}
              fallbackId={kb.wiki_config?.synthesis_model_id}
              type="KnowledgeQA"
            />
          </div>
          <div className="rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-gray-600" />
                <div>
                  <p className="text-sm font-medium text-gray-700">图像处理（VLM）</p>
                  <p className="text-xs text-gray-500">使用视觉模型解析图片</p>
                </div>
              </div>
              <input
                type="checkbox"
                checked={vlmEnabled}
                onChange={(e) => setVlmEnabled(e.target.checked)}
                className="h-5 w-5 text-blue-600"
              />
            </div>
            {vlmEnabled && (
              <div className="mt-3">
                <ModelSelector
                  label="VLM 模型"
                  value={vlmModelId}
                  onChange={setVlmModelId}
                  models={models}
                  fallbackId={kb.vlm_config?.model_id}
                  type="VLLM"
                />
              </div>
            )}
          </div>
        </div>
      </Section>

      <Section title="索引策略" icon={Search}>
        <div className="space-y-3">
          <IndexToggle
            label="RAG 检索"
            desc="向量化 + 关键词索引，支持混合检索"
            checked={vectorEnabled && keywordEnabled}
            onChange={(checked) => {
              setVectorEnabled(checked);
              setKeywordEnabled(checked);
            }}
          />
          <IndexToggle
            label="Wiki 知识库"
            desc="自动生成互相关联的 Wiki 知识页面"
            checked={wikiEnabled}
            onChange={setWikiEnabled}
          />
          <IndexToggle
            label="知识图谱"
            desc="抽取实体关系，构建图索引"
            checked={graphEnabled}
            onChange={setGraphEnabled}
          />
        </div>
      </Section>

      {wikiEnabled && (
        <Section title="Wiki 设置" icon={BookOpen}>
          <div className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700">提取粒度</label>
              <div className="space-y-2">
                {GRANULARITIES.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => setGranularity(g.key)}
                    className={clsx(
                      'flex w-full items-center justify-between rounded-xl border p-3 text-left transition-colors',
                      granularity === g.key
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                    )}
                  >
                    <div>
                      <p className="font-medium">{g.label}</p>
                      <p className="text-xs text-gray-500">{g.desc}</p>
                    </div>
                    {granularity === g.key && <Check className="h-5 w-5 text-blue-600" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </Section>
      )}

      {message && (
        <div
          className={clsx(
            'flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
            message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          )}
        >
          {message.type === 'success' ? <Check className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      <button
        type="submit"
        disabled={saving}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saving ? '保存中…' : '保存配置'}
      </button>
    </form>
  );
}

function IndexToggle({ label, desc, checked, onChange }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
      <div>
        <p className="font-medium text-gray-900">{label}</p>
        <p className="text-xs text-gray-500">{desc}</p>
      </div>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 text-blue-600"
      />
    </div>
  );
}

export default KBSettings;
