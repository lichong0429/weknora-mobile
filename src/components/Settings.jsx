import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useConfig } from '../contexts/ConfigContext.jsx';
import { KB, Model } from '../api/endpoints.js';
import { AlertCircle, CheckCircle, Key, Globe, TestTube, Bug, Cpu, Database, Globe as WebSearchIcon, Activity, ChevronRight, Sun, Moon, Monitor } from 'lucide-react';

function Settings() {
  const navigate = useNavigate();
  const { config, setConfig, theme, setTheme } = useConfig();
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || 'http://localhost:8080');
  const [apiKey, setApiKey] = useState(config.apiKey || '');
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);

  const handleSave = () => {
    setConfig({ baseUrl, apiKey });
    setTestStatus({ type: 'success', message: '配置已保存' });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      setConfig({ baseUrl, apiKey });
      const [kbRes, modelRes] = await Promise.all([KB.list(), Model.list()]);
      const kbCount = Array.isArray(kbRes?.data) ? kbRes.data.length : 0;
      const modelCount = Array.isArray(modelRes?.data) ? modelRes.data.length : 0;
      setTestStatus({ type: 'success', message: `连接成功：知识库 ${kbCount} 个，模型 ${modelCount} 个` });
    } catch (err) {
      setTestStatus({ type: 'error', message: err.message || '连接失败' });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    setBaseUrl(config.baseUrl || 'http://localhost:8080');
    setApiKey(config.apiKey || '');
  }, [config.baseUrl, config.apiKey]);

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">设置</h2>

      <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
            <Globe className="h-4 w-4" /> WeKnora 地址
          </label>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:8080"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">示例：http://localhost:8080 或 https://weknora.example.com，不要加 /api/v1</p>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
            <Key className="h-4 w-4" /> API Key
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">在 WeKnora 账户信息页面获取</p>
        </div>

        {testStatus && (
          <div
            className={clsx(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
              testStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            )}
          >
            {testStatus.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {testStatus.message}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            保存配置
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <TestTube className="h-4 w-4" />
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-900">系统管理</h3>
        <div className="space-y-2">
          <SettingRow icon={Cpu} label="模型管理" desc="对话 / Embedding / Rerank / 视觉 / 语音模型" to="/models" />
          <SettingRow icon={Database} label="向量库" desc="向量存储引擎配置与连接测试" to="/vector-stores" />
          <SettingRow icon={WebSearchIcon} label="网络搜索源" desc="Google / Bing 等搜索 Provider" to="/web-searches" />
          <SettingRow icon={Activity} label="系统信息" desc="版本、解析引擎、存储引擎状态" to="/system" />
        </div>
      </div>

      <button
        onClick={() => navigate('/diagnostics')}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white p-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <Bug className="h-4 w-4" /> 诊断与调试
      </button>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-900">外观</h3>
        <div className="space-y-2">
          {[
            { value: 'system', label: '跟随系统', desc: '随手机深色/浅色模式自动切换', icon: Monitor },
            { value: 'light', label: '浅色', desc: '始终使用浅色主题', icon: Sun },
            { value: 'dark', label: '深色', desc: '始终使用深色主题', icon: Moon }
          ].map((opt) => {
            const Icon = opt.icon;
            const active = theme === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => setTheme(opt.value)}
                className={clsx(
                  'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors',
                  active ? 'border-brand-500 bg-brand-50' : 'border-gray-200 hover:bg-gray-50'
                )}
              >
                <div className={clsx('rounded-xl p-2', active ? 'bg-brand-500 text-white' : 'bg-gray-100 text-gray-600')}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className={clsx('font-medium', active ? 'text-brand-700' : 'text-gray-900')}>{opt.label}</p>
                  <p className="truncate text-xs text-gray-500">{opt.desc}</p>
                </div>
                {active && <CheckCircle className="h-5 w-5 shrink-0 text-brand-500" />}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-2 font-semibold text-gray-900">关于</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          WeKnora Mobile 是基于 WeKnora REST API 构建的移动端客户端，针对手机屏幕优化布局，支持知识库浏览、搜索、智能问答和会话管理。
        </p>
      </div>
    </div>
  );
}

function SettingRow({ icon: Icon, label, desc, to }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="flex w-full items-center gap-3 rounded-xl p-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left"
      aria-label={label}
    >
      <div className="rounded-xl bg-blue-50 p-2 text-blue-600">
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900">{label}</p>
        <p className="truncate text-xs text-gray-500">{desc}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-gray-400" />
    </button>
  );
}

export default Settings;
