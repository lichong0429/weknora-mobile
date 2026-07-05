import { useState, useEffect, useCallback, useRef } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { FAQ } from '../api/endpoints.js';
import {
  HelpCircle, Search, Loader2, AlertCircle, Plus, X, Save,
  Trash2, ChevronRight, RefreshCw
} from 'lucide-react';
import { clsx } from 'clsx';

function FAQView({ kbId, onRefresh }) {
  const [query, setQuery] = useState('');
  const [entries, setEntries] = useState([]);
  const [params, setParams] = useState({ page: 1, page_size: 20 });
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef();
  const [error, setError] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ question: '', answer: '', is_enabled: true, is_recommended: false });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { data, loading, run } = useAsync(
    () => FAQ.listEntries(kbId, { ...params, keyword: query }),
    [kbId, params.page, query]
  );

  useEffect(() => {
    if (data?.data) {
      const items = Array.isArray(data.data) ? data.data : data.data.items || [];
      const total = data.total || data.data.total || 0;
      setEntries((prev) => (params.page === 1 ? items : [...prev, ...items]));
      setHasMore(items.length > 0 && entries.length + items.length < total);
      setLoadingMore(false);
    }
  }, [data]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    setParams((p) => ({ ...p, page: p.page + 1 }));
  }, [loadingMore, hasMore]);

  const lastItemRef = useCallback((node) => {
    if (loadingMore || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '100px' });
    if (node) observerRef.current.observe(node);
  }, [loadingMore, hasMore, loadMore]);

  const handleSearch = (e) => {
    e.preventDefault();
    setParams({ page: 1, page_size: 20 });
    setEntries([]);
    run();
  };

  const resetForm = () => {
    setForm({ question: '', answer: '', is_enabled: true, is_recommended: false });
    setEditing(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowCreate(true);
  };

  const handleEdit = (entry) => {
    setEditing(entry);
    setForm({
      question: entry.question || '',
      answer: entry.answer || '',
      is_enabled: entry.is_enabled !== false,
      is_recommended: entry.is_recommended === true
    });
    setShowCreate(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.question.trim()) return;
    setSaving(true);
    try {
      if (editing) {
        await FAQ.updateEntry(kbId, editing.id, form);
      } else {
        await FAQ.createEntry(kbId, form);
      }
      setShowCreate(false);
      resetForm();
      setParams({ page: 1, page_size: 20 });
      setEntries([]);
      run();
      onRefresh?.();
    } catch (err) {
      setError(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (entry) => {
    if (!window.confirm('确定删除该 FAQ 条目？')) return;
    setDeleting(true);
    try {
      await FAQ.removeEntries(kbId, [entry.id]);
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      onRefresh?.();
    } catch (err) {
      setError(err.message || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-3">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 FAQ…"
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          type="button"
          onClick={handleOpenCreate}
          className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" /> 新增
        </button>
        <button
          type="button"
          onClick={() => { setParams({ page: 1, page_size: 20 }); setEntries([]); run(); }}
          className="rounded-xl bg-white p-2 text-gray-600 shadow-sm"
        >
          <RefreshCw className={clsx('h-5 w-5', loading && 'animate-spin')} />
        </button>
      </form>

      {error && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {loading && entries.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载 FAQ…
        </div>
      )}

      <div className="space-y-2">
        {entries.map((entry, idx) => (
          <div
            key={entry.id}
            ref={idx === entries.length - 1 ? lastItemRef : null}
            className="rounded-2xl bg-white p-3 shadow-sm"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <HelpCircle className="h-5 w-5 shrink-0 text-amber-600" />
                <h4 className="text-sm font-semibold text-gray-900">{entry.question}</h4>
              </div>
              <div className="flex shrink-0 gap-1">
                {entry.is_recommended && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">推荐</span>}
                {!entry.is_enabled && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500">禁用</span>}
              </div>
            </div>
            <p className="mb-3 text-sm text-gray-600 line-clamp-3">{entry.answer}</p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => handleEdit(entry)}
                className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
              >
                编辑
              </button>
              <button
                onClick={() => handleDelete(entry)}
                disabled={deleting}
                className="rounded-lg bg-red-50 px-2 py-1 text-xs font-medium text-red-600 disabled:opacity-50"
              >
                删除
              </button>
            </div>
          </div>
        ))}
      </div>

      {loadingMore && (
        <div className="py-3 text-center text-sm text-gray-500">
          <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 加载中…
        </div>
      )}

      {!hasMore && entries.length > 0 && (
        <div className="py-3 text-center text-xs text-gray-400">已加载全部 FAQ</div>
      )}

      {!loading && entries.length === 0 && (
        <div className="py-8 text-center text-sm text-gray-400">暂无 FAQ 条目</div>
      )}

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">{editing ? '编辑 FAQ' : '新增 FAQ'}</h3>
              <button
                onClick={() => { setShowCreate(false); resetForm(); }}
                className="rounded-full p-1 hover:bg-gray-100"
              >
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleSave} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">问题</label>
                <input
                  value={form.question}
                  onChange={(e) => setForm({ ...form, question: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="请输入问题"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">答案</label>
                <textarea
                  value={form.answer}
                  onChange={(e) => setForm({ ...form, answer: e.target.value })}
                  rows={4}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  placeholder="请输入答案"
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.is_enabled}
                    onChange={(e) => setForm({ ...form, is_enabled: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  启用
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.is_recommended}
                    onChange={(e) => setForm({ ...form, is_recommended: e.target.checked })}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  推荐
                </label>
              </div>
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

export default FAQView;
