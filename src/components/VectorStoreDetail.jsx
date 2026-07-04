import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { VectorStore } from '../api/endpoints.js';
import {
  Loader2, AlertCircle, Save, Database, CheckCircle, XCircle, Trash2
} from 'lucide-react';
import { clsx } from 'clsx';

function VectorStoreDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => VectorStore.detail(id), [id]);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null);

  const store = data?.data;

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await VectorStore.testById(id);
      setTestStatus({ ok: res.success, msg: res.success ? `连接成功${res.version ? `（版本 ${res.version}）` : ''}` : res.error || '连接失败' });
    } catch (err) {
      setTestStatus({ ok: false, msg: err.message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await VectorStore.update(id, { name });
      run();
      alert('保存成功');
    } catch (err) {
      alert(err.message || '保存失败');
    } finally {
      setSaving(false);
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

  if (!store) return null;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center gap-3">
        <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
          <Database className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-gray-900">{store.name}</h2>
          <p className="text-xs text-gray-500">{store.engine_type} · {store.source}</p>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
          <input
            defaultValue={store.name}
            onChange={(e) => setName(e.target.value)}
            disabled={store.readonly}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">引擎</label>
          <p className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">{store.engine_type}</p>
        </div>

        {store.connection_config && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">连接配置</label>
            <pre className="max-h-40 overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
              {JSON.stringify(store.connection_config, null, 2)}
            </pre>
          </div>
        )}

        {store.index_config && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">索引配置</label>
            <pre className="max-h-40 overflow-auto rounded-xl bg-gray-50 p-3 text-xs text-gray-700">
              {JSON.stringify(store.index_config, null, 2)}
            </pre>
          </div>
        )}

        {!store.readonly && (
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中…' : '保存名称'}
          </button>
        )}
      </form>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">连通性测试</h3>
          <button
            onClick={handleTest}
            disabled={testing}
            className="rounded-xl bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 disabled:opacity-50"
          >
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
        {testStatus && (
          <div className={clsx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', testStatus.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
            {testStatus.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
            {testStatus.msg}
          </div>
        )}
      </div>

      {store.readonly && (
        <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-700">
          该向量库由环境变量配置，只读，无法修改或删除。
        </div>
      )}
    </div>
  );
}

export default VectorStoreDetail;
