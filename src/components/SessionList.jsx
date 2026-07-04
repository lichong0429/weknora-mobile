import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Session } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import { MessageSquare, Plus, Pin, Trash2, Loader2, AlertCircle, X, MessageSquarePlus } from 'lucide-react';
import { clsx } from 'clsx';

function SessionList() {
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const { data, loading, error, run, setData } = useAsync(() => Session.list({ page: 1, page_size: 50 }), []);
  const sessions = extractList(data);

  const handleCreate = async (e) => {
    e.preventDefault();
    const res = await Session.create({ title: title.trim() || undefined });
    navigate(`/session/${res.data.id}`);
  };

  const togglePin = async (s, e) => {
    e.stopPropagation();
    if (s.is_pinned) {
      await Session.unpin(s.id);
    } else {
      await Session.pin(s.id);
    }
    run();
  };

  const handleDelete = async (s, e) => {
    e.stopPropagation();
    if (!window.confirm('确定删除该会话？')) return;
    await Session.remove(s.id);
    run();
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">会话</h2>
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
        {sessions.map((s) => (
          <div
            key={s.id}
            onClick={() => navigate(`/session/${s.id}`)}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
          >
            <div className="rounded-xl bg-violet-50 p-2 text-violet-600">
              <MessageSquare className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-gray-900">{s.title || '未命名会话'}</h3>
                {s.is_pinned && <Pin className="h-3.5 w-3.5 fill-blue-600 text-blue-600" />}
              </div>
              <p className="truncate text-xs text-gray-500">
                {new Date(s.created_at).toLocaleString()} · {s.description || '无描述'}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => togglePin(s, e)}
                className={clsx('rounded-full p-2', s.is_pinned ? 'bg-blue-100 text-blue-600' : 'text-gray-400 hover:bg-gray-100')}
              >
                <Pin className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => handleDelete(s, e)}
                className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold">新建会话</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">标题（可选）</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="新会话"
                />
              </div>
              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <MessageSquarePlus className="h-4 w-4" /> 创建会话
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default SessionList;
