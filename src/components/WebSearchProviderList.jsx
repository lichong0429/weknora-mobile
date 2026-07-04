import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { WebSearch } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import {
  Plus, Globe, ChevronRight, Loader2, AlertCircle, X,
  CheckCircle, XCircle, Star
} from 'lucide-react';
import { clsx } from 'clsx';

function WebSearchProviderList() {
  const navigate = useNavigate();
  const { data, loading, error, run, setData } = useAsync(() => WebSearch.list(), []);
  const { data: typesData } = useAsync(() => WebSearch.types(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [providerType, setProviderType] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [parameters, setParameters] = useState({});
  const [isDefault, setIsDefault] = useState(false);
  const [creating, setCreating] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null);

  const providers = extractList(data);
  const types = typesData?.data || [];

  useEffect(() => {
    if (types.length && !providerType) {
      setProviderType(types[0].provider);
    }
  }, [types]);

  const selectedType = types.find((t) => t.provider === providerType);

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await WebSearch.test({ provider: providerType, parameters });
      setTestStatus({ ok: res.success, msg: res.success ? '连接成功' : res.error || '连接失败' });
    } catch (err) {
      setTestStatus({ ok: false, msg: err.message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim() || !providerType) return;
    setCreating(true);
    try {
      const res = await WebSearch.create({
        name,
        provider: providerType,
        description,
        parameters,
        is_default: isDefault
      });
      setData({ data: [res.data, ...providers] });
      setShowCreate(false);
      setName('');
      setDescription('');
      setParameters({});
      setIsDefault(false);
      setTestStatus(null);
    } catch (err) {
      alert(err.message || '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleRemove = async (id) => {
    if (!confirm('确定删除该搜索源？')) return;
    try {
      await WebSearch.remove(id);
      setData({ data: providers.filter((p) => p.id !== id) });
    } catch (err) {
      alert(err.message || '删除失败');
    }
  };

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">网络搜索</h2>
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
        {providers.map((p) => (
          <div
            key={p.id}
            onClick={() => navigate(`/web-search/${p.id}`)}
            className="flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
          >
            <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
              <Globe className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate font-semibold text-gray-900">{p.name}</h3>
                {p.is_default && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />}
              </div>
              <p className="truncate text-xs text-gray-500">{p.provider}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); handleRemove(p.id); }}
                className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
              >
                <X className="h-4 w-4" />
              </button>
              <ChevronRight className="h-5 w-5 text-gray-400" />
            </div>
          </div>
        ))}
      </div>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">新建搜索源</h3>
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
                <label className="mb-1 block text-sm font-medium text-gray-700">类型</label>
                <select
                  value={providerType}
                  onChange={(e) => {
                    setProviderType(e.target.value);
                    setParameters({});
                  }}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none"
                >
                  {types.map((t) => (
                    <option key={t.provider} value={t.provider}>{t.label || t.provider}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">描述</label>
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>

              {selectedType?.parameter_schema?.map((field) => (
                <div key={field.name}>
                  <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                    {field.label || field.name}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type={field.type === 'password' || field.name.toLowerCase().includes('key') ? 'password' : 'text'}
                    value={parameters[field.name] || ''}
                    onChange={(e) => setParameters({ ...parameters, [field.name]: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              ))}

              <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
                <div>
                  <p className="text-sm font-medium text-gray-700">设为默认</p>
                </div>
                <input
                  type="checkbox"
                  checked={isDefault}
                  onChange={(e) => setIsDefault(e.target.checked)}
                  className="h-5 w-5 text-blue-600"
                />
              </div>

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
                  {testing ? '测试中…' : '测试'}
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

export default WebSearchProviderList;
