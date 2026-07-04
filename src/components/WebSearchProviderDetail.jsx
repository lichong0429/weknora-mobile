import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { WebSearch } from '../api/endpoints.js';
import {
  Loader2, AlertCircle, Save, Globe, CheckCircle, XCircle, Trash2, Star
} from 'lucide-react';
import { clsx } from 'clsx';

function WebSearchProviderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => WebSearch.detail(id), [id]);
  const { data: typesData } = useAsync(() => WebSearch.types(), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testStatus, setTestStatus] = useState(null);

  const provider = data?.data;
  const types = typesData?.data || [];
  const schema = types.find((t) => t.provider === provider?.provider)?.parameter_schema || [];

  useEffect(() => {
    if (provider) {
      setForm({
        name: provider.name || '',
        description: provider.description || '',
        parameters: provider.parameters || {},
        is_default: provider.is_default || false
      });
    }
  }, [provider]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await WebSearch.update(id, form);
      alert('保存成功');
      run();
    } catch (err) {
      alert(err.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      const res = await WebSearch.testById(id);
      setTestStatus({ ok: res.success, msg: res.success ? '连接成功' : res.error || '连接失败' });
    } catch (err) {
      setTestStatus({ ok: false, msg: err.message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    if (!confirm('确定删除该搜索源？')) return;
    try {
      await WebSearch.remove(id);
      navigate('/web-searches');
    } catch (err) {
      alert(err.message || '删除失败');
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

  if (!form || !provider) return null;

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-50 p-2 text-emerald-600">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{provider.name}</h2>
            <p className="text-xs text-gray-500">{provider.provider}</p>
          </div>
        </div>
        <button
          onClick={handleRemove}
          className="rounded-full p-2 text-gray-400 hover:bg-red-50 hover:text-red-600"
        >
          <Trash2 className="h-5 w-5" />
        </button>
      </div>

      <form onSubmit={handleSave} className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">名称</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">描述</label>
          <input
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        {schema.map((field) => (
          <div key={field.name}>
            <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
              {field.label || field.name}
              {field.required && <span className="text-red-500">*</span>}
            </label>
            <input
              type={field.name.toLowerCase().includes('key') ? 'password' : 'text'}
              value={form.parameters[field.name] || ''}
              onChange={(e) => setForm({ ...form, parameters: { ...form.parameters, [field.name]: e.target.value } })}
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        ))}

        <div className="flex items-center justify-between rounded-xl border border-gray-200 p-3">
          <div className="flex items-center gap-2">
            <Star className={clsx('h-4 w-4', form.is_default ? 'fill-amber-400 text-amber-400' : 'text-gray-400')} />
            <p className="text-sm font-medium text-gray-700">设为默认搜索源</p>
          </div>
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => setForm({ ...form, is_default: e.target.checked })}
            className="h-5 w-5 text-blue-600"
          />
        </div>

        <button
          type="submit"
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中…' : '保存'}
        </button>
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
    </div>
  );
}

export default WebSearchProviderDetail;
