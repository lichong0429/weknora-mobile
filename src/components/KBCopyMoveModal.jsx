import { useState } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { KB, Agent } from '../api/endpoints.js';
import { X, Copy, ArrowRightLeft, Loader2, AlertCircle, Check, Bot } from 'lucide-react';
import { clsx } from 'clsx';

function KBCopyMoveModal({ kb, onClose, onSuccess }) {
  const [mode, setMode] = useState('copy');
  const [targetAgentId, setTargetAgentId] = useState('');
  const [newName, setNewName] = useState(`${kb.name} 副本`);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  const { data: agentsRes, loading: agentsLoading, error: agentsError } = useAsync(() => Agent.list(), []);
  const agents = (() => {
    if (!agentsRes) return [];
    if (Array.isArray(agentsRes)) return agentsRes;
    if (Array.isArray(agentsRes.data)) return agentsRes.data;
    if (Array.isArray(agentsRes.data?.items)) return agentsRes.data.items;
    return [];
  })();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(false);
    try {
      if (mode === 'copy') {
        await KB.copy(kb.id, { name: newName });
      } else {
        await KB.move(kb.id, { target_agent_id: targetAgentId || undefined });
      }
      setSuccess(true);
      onSuccess?.();
      setTimeout(() => onClose(), 800);
    } catch (err) {
      setError(err.message || '操作失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">{mode === 'copy' ? '复制知识库' : '移动知识库'}</h3>
          <button onClick={onClose} className="rounded-full p-1 hover:bg-gray-100">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-gray-100 p-1">
          <button
            type="button"
            onClick={() => setMode('copy')}
            className={clsx(
              'flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium transition-colors',
              mode === 'copy' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'
            )}
          >
            <Copy className="h-4 w-4" /> 复制
          </button>
          <button
            type="button"
            onClick={() => setMode('move')}
            className={clsx(
              'flex items-center justify-center gap-1 rounded-lg py-2 text-sm font-medium transition-colors',
              mode === 'move' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600'
            )}
          >
            <ArrowRightLeft className="h-4 w-4" /> 移动
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === 'copy' ? (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">新名称</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>
          ) : (
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">目标智能体 / 租户</label>
              {agentsLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-gray-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> 加载智能体…
                </div>
              ) : (
                <>
                  <select
                    value={targetAgentId}
                    onChange={(e) => setTargetAgentId(e.target.value)}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm"
                  >
                    <option value="">保持当前位置</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name || a.id}
                      </option>
                    ))}
                  </select>
                  {agentsError && <p className="mt-1 text-xs text-red-600">加载智能体失败：{agentsError}</p>}
                </>
              )}
            </div>
          )}

          {error && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <div className="flex items-center gap-1 font-medium">
                <AlertCircle className="h-4 w-4" /> {error}
              </div>
            </div>
          )}

          {success && (
            <div className="rounded-xl bg-green-50 p-3 text-sm text-green-700">
              <div className="flex items-center gap-1 font-medium">
                <Check className="h-4 w-4" /> 操作成功
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'copy' ? <Copy className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
            {loading ? '处理中' : mode === 'copy' ? '复制' : '移动'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default KBCopyMoveModal;
