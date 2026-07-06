import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Knowledge } from '../api/endpoints.js';
import { get } from '../api/client.js';
import { Loader2, AlertCircle, Trash2, RefreshCw, XCircle, Save, ArrowLeft } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import KnowledgeChunks from './KnowledgeChunks.jsx';

function KnowledgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => Knowledge.detail(id), [id]);
  const knowledge = data?.data;

  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewDebug, setPreviewDebug] = useState([]);
  const [showPreviewDebug, setShowPreviewDebug] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (knowledge) {
      setTitle(knowledge.title || '');
      setDescription(knowledge.description || '');
      loadPreview();
    }
  }, [knowledge]);

  const loadPreview = async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewDebug([]);
    const attempts = [];

    try {
      const res = await Knowledge.preview(id);
      attempts.push({ source: 'GET /knowledge/{id}/preview (text)', ok: true, status: 'success' });
      setPreviewDebug(attempts);
      const text = typeof res === 'string' ? res : JSON.stringify(res, null, 2);
      setPreview(text);
      if (knowledge?.type === 'manual') setContent(text);
      setPreviewLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'GET /knowledge/{id}/preview (text)', ok: false, error: err.message });
    }

    try {
      const res = await get(`/knowledge/${id}/preview`);
      attempts.push({ source: 'GET /knowledge/{id}/preview (json)', ok: true, status: 'success' });
      setPreviewDebug(attempts);
      const text = extractPreviewText(res);
      setPreview(text);
      if (knowledge?.type === 'manual') setContent(text);
      setPreviewLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'GET /knowledge/{id}/preview (json)', ok: false, error: err.message });
    }

    try {
      const res = await get(`/knowledge/${id}`);
      attempts.push({ source: 'GET /knowledge/{id}', ok: true, status: 'success' });
      setPreviewDebug(attempts);
      const text = extractPreviewText(res?.data || res);
      setPreview(text);
      if (knowledge?.type === 'manual') setContent(text);
      setPreviewLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'GET /knowledge/{id}', ok: false, error: err.message });
    }

    setPreviewDebug(attempts);
    setPreviewError('无法加载预览，所有接口均失败。');
    setPreviewLoading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { title, description };
      if (knowledge.type === 'manual') {
        await Knowledge.updateManual(id, { title, content, description });
      } else {
        await Knowledge.update(id, payload);
      }
      run();
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('确定删除该知识？')) return;
    try {
      await Knowledge.remove(id);
      navigate('/kbs');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReparse = async () => {
    try {
      await Knowledge.reparse(id);
      run();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCancel = async () => {
    try {
      await Knowledge.cancelParse(id);
      run();
    } catch (err) {
      alert(err.message);
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
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!knowledge) return null;

  return (
    <div className="p-4">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> 返回
          </button>
          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
              {editing ? '取消' : '编辑'}
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {knowledge.type === 'manual' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">正文</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-mono"
                  placeholder={preview ? '首次编辑会覆盖原内容，建议先预览' : ''}
                />
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {saving ? '保存中' : '保存'}
            </button>
          </div>
        ) : (
          <>
            <h2 className="mb-1 text-lg font-bold text-gray-900">{knowledge.title || knowledge.file_name}</h2>
            <p className="text-sm text-gray-500">{knowledge.description || '暂无描述'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{knowledge.type}</span>
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{knowledge.parse_status}</span>
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{knowledge.enable_status}</span>
              {knowledge.file_size && (
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">
                  {(knowledge.file_size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={handleReparse}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 text-xs font-medium text-gray-700 shadow-sm"
            >
              <RefreshCw className="h-4 w-4" /> 重新解析
            </button>
            <button
              onClick={handleCancel}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 text-xs font-medium text-gray-700 shadow-sm"
            >
              <XCircle className="h-4 w-4" /> 取消解析
            </button>
            <button
              onClick={handleDelete}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 text-xs font-medium text-red-600 shadow-sm"
            >
              <Trash2 className="h-4 w-4" /> 删除
            </button>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">预览</h3>
              <button onClick={loadPreview} className="text-xs text-blue-600">刷新</button>
            </div>
            {previewLoading ? (
              <div className="py-8 text-center text-sm text-gray-500">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载预览…
              </div>
            ) : previewError ? (
              <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                <p>{previewError}</p>
                <button
                  onClick={() => setShowPreviewDebug((s) => !s)}
                  className="mt-2 text-xs text-gray-600"
                >
                  {showPreviewDebug ? '隐藏调试' : '显示调试'}
                </button>
                {showPreviewDebug && (
                  <div className="mt-2 rounded-lg bg-gray-900 p-2 text-xs text-gray-100">
                    {previewDebug.map((a, i) => (
                      <div key={i} className={a.ok ? 'text-green-400' : 'text-red-400'}>
                        {a.ok ? '✓' : '✗'} {a.source}: {a.ok ? a.status : a.error}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : preview ? (
              <div className="prose prose-sm max-w-none text-sm text-gray-700">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{preview}</ReactMarkdown>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-gray-400">暂无预览内容</div>
            )}
          </div>

          {knowledge.type !== 'manual' && (
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <h3 className="mb-3 font-semibold text-gray-900">分块</h3>
              <KnowledgeChunks knowledgeId={id} kbId={knowledge.knowledge_base_id} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function extractPreviewText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  const candidates = [data.preview, data.content, data.text, data.body, data.markdown, data.html];
  for (const c of candidates) {
    if (typeof c === 'string') return c;
  }
  return JSON.stringify(data, null, 2);
}

export default KnowledgeDetail;
