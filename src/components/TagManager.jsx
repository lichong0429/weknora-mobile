import { useState, useEffect } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { Tag } from '../api/endpoints.js';
import {
  Tag as TagIcon, Plus, X, Save, Trash2, Loader2, AlertCircle, RefreshCw
} from 'lucide-react';
import { clsx } from 'clsx';

const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

function TagManager({ kbId }) {
  const { data, loading, error, run } = useAsync(() => Tag.list(kbId, { page_size: 100 }), [kbId]);
  const tags = Array.isArray(data?.data) ? data.data : data?.data?.items || [];

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', color: PRESET_COLORS[0] });
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

  useEffect(() => {
    if (data) setFormError(null);
  }, [data]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await Tag.update(kbId, editing.id, { name: form.name, color: form.color });
      } else {
        await Tag.create(kbId, { name: form.name, color: form.color });
      }
      setShowCreate(false);
      setEditing(null);
      setForm({ name: '', color: PRESET_COLORS[0] });
      run();
    } catch (err) {
      setFormError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tag) => {
    setEditing(tag);
    setForm({ name: tag.name, color: tag.color || PRESET_COLORS[0] });
    setShowCreate(true);
  };

  const handleDelete = async (tag) => {
    if (!window.confirm(`确定删除标签「${tag.name}」？`)) return;
    setDeletingId(tag.id);
    try {
      await Tag.remove(kbId, tag.id, { force: false });
      run();
    } catch (err) {
      alert(err.message || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 flex items-center gap-2">
          <TagIcon className="h-4 w-4" /> 标签管理
        </h3>
        <div className="flex gap-2">
          <button onClick={run} disabled={loading} className="text-gray-500">
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          </button>
          <button
            onClick={() => { setEditing(null); setForm({ name: '', color: PRESET_COLORS[0] }); setShowCreate(true); }}
            className="flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600"
          >
            <Plus className="h-3 w-3" /> 新建
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error.message}</div>
      )}

      {loading && tags.length === 0 && (
        <div className="py-4 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 加载中…
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {tags.map((tag) => (
          <div
            key={tag.id}
            onClick={() => handleEdit(tag)}
            className="group flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium shadow-sm"
            style={{ backgroundColor: tag.color ? `${tag.color}20` : '#f3f4f6', color: tag.color || '#374151' }}
          >
            <TagIcon className="h-3 w-3" />
            <span>{tag.name}</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(tag); }}
              disabled={deletingId === tag.id}
              className="ml-1 rounded-full p-0.5 hover:bg-black/10"
            >
              <Trash2 className={clsx('h-3 w-3', deletingId === tag.id && 'animate-spin')} />
            </button>
          </div>
        ))}
      </div>

      {!loading && tags.length === 0 && (
        <p className="py-4 text-center text-sm text-gray-400">暂无标签</p>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? '编辑标签' : '新建标签'}</h3>
              <button
                onClick={() => { setShowCreate(false); setEditing(null); setFormError(null); }}
                className="rounded-full p-1 hover:bg-gray-100"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="标签名称"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">颜色</label>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, color: c })}
                      className={clsx(
                        'h-8 w-8 rounded-full border-2',
                        form.color === c ? 'border-gray-900' : 'border-transparent'
                      )}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>
              {formError && (
                <div className="rounded-xl bg-red-50 p-2 text-sm text-red-700">{formError}</div>
              )}
              <button
                type="submit"
                disabled={saving}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
              >
                <Save className="h-4 w-4" /> {saving ? '保存中' : '保存'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default TagManager;
