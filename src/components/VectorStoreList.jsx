import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { VectorStore } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import {
  Plus, Database, ChevronRight, Loader2, AlertCircle, X,
  Server, HardDrive, CheckCircle, XCircle
} from 'lucide-react';
import { clsx } from 'clsx';

function fieldInput(field, value, onChange) {
  const v = value ?? field.default ?? '';
  if (field.type === 'boolean') {
    return (
      <input
        type="checkbox"
        checked={Boolean(v)}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 text-blue-600"
      />
    );
  }
  if (field.type === 'number') {
    return (
      <input
        type="number"
        value={v}
        onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    );
  }
  return (
    <input
      type={field.sensitive ? 'password' : 'text'}
      value={v}
      onChange={(e) => onChange(e.target.value)}
      placeholder={field.description || ''}
      className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
    />
  );
}

function VectorStoreList() {
  const navigate = useNavigate();
  const { data, loading, error, run, setData } = useAsync(() => VectorStore.list(), []);
  const { data: typesData } = useAsync(() => VectorStore.types(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [engineType, setEngineType] = useState('');
  const [name, setName] = useState('');
  const [connection, setConnection] = useState({});
  const [index, setIndex] = useState({});
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null);

  const stores = extractList(data);
  const types = typesData?.data || [];

  useEffect(() => {
    if (types.length && !engineType) {
      setEngineType(types[0].type);
    }
  }, [types]);

  const selectedType = types.find((t) => t.type === engineType);

  const handleTest = async () => {
    if (!selectedType) return;
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await VectorStore.test({ engine_type: engineType, connection_config: connection });
      setTestStatus({ ok: res.success, msg: res.success ? `连接成功${res.version ? `（版本 ${res.version}）` : ''}` : res.error || '连接失败' });
    } catch (err) {
      setTestStatus({ ok: false, msg: err.message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !engineType) return;
    const body = { name, engine_type: engineType, connection_config: connection };
    if (Object.keys(index).length) body.index_config = index;
    setCreating(true);
    try {
      const res = await VectorStore.create(body);
      setData({ data: [res.data, ...stores] });
      setShowCreate(false);
      setName('');
      setConnection({});
      setIndex({});
      setTestStatus(null);
    } catch (err) {
      alert(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (id) => {
    if (!confirm('确定删除该向量存储？')) return;
    try {
      await VectorStore.remove(id);
      setData({ data: stores.filter((s) => s.id !== id) });
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">向量库</h2>
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
        {stores.map((store) => (
          <div
            key={store.id}
            onClick={() => navigate(`/vector-store/${store.id}`)}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
          >
            <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
              <Database className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-gray-900">{store.name}</h3>
                {store.readonly && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">只读</span>
                )}
              </div>
              <p className="truncate text-xs text-gray-500">
                {store.engine_type} · {store.source === 'env' ? '环境变量' : '用户配置'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {!store.readonly && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleRemove(store.id); }}
                  className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <ChevronRight className="h-5 w-5 text-gray-400" />
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">新建向量库</h3>
              <button onClick={() => setShowCreate(false)} className="rounded-full p-1 hover:bg-gray-100">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">引擎类型</label>
                <select
                  value={engineType}
                  onChange={(e) => {
                    setEngineType(e.target.value);
                    setConnection({});
                    setIndex({});
                  }}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {types.map((t) => (
                    <option key={t.type} value={t.type}>{t.display_name || t.type}</option>
                  ))}
                </select>
              </div>

              {selectedType?.connection_fields?.map((field) => (
                <div key={field.name}>
                  <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                    {field.name}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {fieldInput(field, connection[field.name], (val) => setConnection({ ...connection, [field.name]: val }))}
                  {field.description && <p className="mt-1 text-xs text-gray-500">{field.description}</p>}
                </div>
              ))}

              {selectedType?.index_fields?.map((field) => (
                <div key={field.name}>
                  <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                    {field.name}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {fieldInput(field, index[field.name], (val) => setIndex({ ...index, [field.name]: val }))}
                  {field.description && <p className="mt-1 text-xs text-gray-500">{field.description}</p>}
                </div>
              ))}

              {testStatus && (
                <div className={clsx('flex items-center gap-2 rounded-xl px-3 py-2 text-sm', testStatus.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                  {testStatus.ok ? <CheckCircle className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {testStatus.msg}
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
                  type="button"
                  onClick={handleTest}
                  disabled={testing}
                  className="flex-1 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm font-medium text-blue-700 disabled:opacity-50"
                >
                  {testing ? '测试中…' : '测试连接'}
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

export default VectorStoreList;
