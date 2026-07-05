import { useState } from 'react';
import { Knowledge } from '../api/endpoints.js';
import { X, Link, FileText, Save, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

const MODES = [
  { key: 'url', label: '网页链接', icon: Link },
  { key: 'manual', label: '手动创建', icon: FileText }
];

function CreateKnowledgeModal({ kbId, onClose, onCreated }) {
  const [mode, setMode] = useState('url');
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (mode === 'url') {
        await Knowledge.url(kbId, { url });
      } else {
        await Knowledge.manual(kbId, { title, content, status: 'enabled' });
      }
      onCreated?.();
      onClose();
    } catch (err) {
      setError(err.message || '创建失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">添加知识</h3>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="mb-4 flex rounded-xl bg-gray-100 p-1">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium transition-colors',
                  mode === m.key ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500'
                )}
              >
                <Icon className="h-4 w-4" /> {m.label}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'url' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">网页链接</label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                placeholder="https://..."
              />
            </div>
          ) : (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">标题</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="知识标题"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">正文</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={6}
                  required
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="支持 Markdown"
                />
              </div>
            </>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default CreateKnowledgeModal;
