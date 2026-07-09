import { useState, useEffect } from 'react';
import { getLogs, clearLogs } from '../api/debug.js';
import { getConfig } from '../config.js';
import { KB, Model, VectorStore, WebSearch, Agent, Session, Tenant } from '../api/endpoints.js';
import {
  Trash2, RefreshCw, AlertCircle, CheckCircle, ChevronDown, ChevronUp,
  Server, Copy, Check, Terminal, Building2, KeyRound, FlaskConical,
  Search, Link2
} from 'lucide-react';
import { clsx } from 'clsx';

const APP_VERSION = 'v1.1.6';

function extractList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.data?.items)) return result.data.items;
  if (Array.isArray(result?.data?.list)) return result.data.list;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function extractSuccess(result) {
  return result?.success === true || result?.success === undefined;
}

const endpoints = [
  { key: 'kb', label: '知识库', fn: () => KB.list(), path: 'GET /knowledge-bases' },
  { key: 'model', label: '模型', fn: () => Model.list(), path: 'GET /models' },
  { key: 'agent', label: '智能体', fn: () => Agent.list(), path: 'GET /agents' },
  { key: 'session', label: '会话', fn: () => Session.list(), path: 'GET /sessions' },
  { key: 'vector', label: '向量库', fn: () => VectorStore.list(), path: 'GET /vector-stores' },
  { key: 'websearch', label: '网络搜索', fn: () => WebSearch.list(), path: 'GET /web-search-providers' }
];

function buildBaseUrl() {
  return (getConfig().baseUrl || 'http://localhost:8080').replace(/\/$/, '');
}

function buildUrl(path) {
  const base = buildBaseUrl();
  const normalized = path.startsWith('/api/v1') ? path : `/api/v1${path.startsWith('/') ? path : `/${path}`}`;
  return `${base}${normalized}`;
}

function buildCurl(path, authHeader, key) {
  const url = buildUrl(path.replace(/^GET\s+/, '').replace(/^\/api\/v1/, ''));
  const keyPart = key || 'YOUR_API_KEY';
  const header = authHeader === 'bearer' ? `Authorization: Bearer ${keyPart}` : `X-API-Key: ${keyPart}`;
  return `curl -s -X GET "${url}" \\\n  -H "Content-Type: application/json" \\\n  -H "${header}"`;
}

async function rawGet(path, { authHeader = 'xapikey', tenantId = '' } = {}) {
  const url = new URL(buildUrl(path), window.location.origin);
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  const key = getConfig().apiKey || '';
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (authHeader === 'bearer') {
    headers['Authorization'] = `Bearer ${key}`;
  } else {
    headers['X-API-Key'] = key;
  }
  const res = await fetch(url.toString(), { headers });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, statusText: res.statusText, body: text, json, url: url.toString() };
}

function Diagnostics() {
  const [logs, setLogs] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [configView, setConfigView] = useState(null);
  const [results, setResults] = useState({});
  const [tenants, setTenants] = useState({ loading: false, data: [], error: null });
  const [copied, setCopied] = useState(null);
  const [authMode, setAuthMode] = useState('xapikey');
  const [tenantId, setTenantId] = useState('');
  const [customPath, setCustomPath] = useState('/knowledge-bases');
  const [customResult, setCustomResult] = useState(null);
  const [customLoading, setCustomLoading] = useState(false);

  const refresh = () => {
    setLogs(getLogs());
    const cfg = getConfig();
    setConfigView({
      baseUrl: cfg.baseUrl || 'http://localhost:8080',
      useProxy: cfg.useProxy || false,
      apiKey: cfg.apiKey ? `${cfg.apiKey.slice(0, 4)}****${cfg.apiKey.slice(-4)}` : '未设置'
    });
  };

  useEffect(() => {
    refresh();
  }, []);

  const runTest = async (ep) => {
    setResults((prev) => ({ ...prev, [ep.key]: { loading: true, error: null, response: null, count: null } }));
    try {
      const res = await ep.fn();
      const list = extractList(res);
      setResults((prev) => ({
        ...prev,
        [ep.key]: { loading: false, error: null, response: res, count: list.length, success: extractSuccess(res), path: ep.path }
      }));
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [ep.key]: { loading: false, error: err.message || String(err), response: null, count: null, success: false, path: ep.path }
      }));
    } finally {
      refresh();
    }
  };

  const runAll = () => {
    endpoints.forEach((ep) => runTest(ep));
  };

  const loadTenants = async () => {
    setTenants({ loading: true, data: [], error: null });
    try {
      const res = await Tenant.list();
      const list = extractList(res);
      setTenants({ loading: false, data: list, error: null });
    } catch (err) {
      setTenants({ loading: false, data: [], error: err.message || String(err) });
    } finally {
      refresh();
    }
  };

  const runCustomProbe = async () => {
    setCustomLoading(true);
    setCustomResult(null);
    try {
      const path = customPath.replace(/^\/?api\/v1\/?/, '').replace(/^\//, '');
      const res = await rawGet(path, { authHeader: authMode, tenantId });
      setCustomResult(res);
    } catch (err) {
      setCustomResult({ error: err.message || String(err) });
    } finally {
      setCustomLoading(false);
      refresh();
    }
  };

  const toggle = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">诊断与调试</h2>
      <p className="mb-4 text-xs text-gray-500">应用版本：{APP_VERSION}（如果版本低于 v1.1.6，请强制刷新页面或重新安装 APK）</p>

      {configView && (
        <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 font-semibold text-gray-900">当前配置</h3>
          <div className="space-y-1 text-sm text-gray-700">
            <p><span className="font-medium">地址：</span>{configView.baseUrl}</p>
            <p><span className="font-medium">代理模式：</span>{configView.useProxy ? '是' : '否'}</p>
            <p><span className="font-medium">API Key：</span>{configView.apiKey}</p>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            提示：地址只需填写到端口，例如 http://localhost:8080，不要加 /api/v1。
          </p>
        </div>
      )}

      <div className="mb-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <AlertCircle className="h-4 w-4" /> 如果所有接口都显示“0 条”
        </div>
        <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed">
          <li>API Key 通常对应一个租户。请确认网页端看到的知识库和该 API Key 属于同一个租户。</li>
          <li>点击下方“加载租户列表”查看当前 API Key 能访问哪些租户。</li>
          <li>在“自定义探测”中尝试切换认证头（X-API-Key / Bearer）或加 tenant_id 参数。</li>
          <li>把下方“原始响应”或“curl 命令”复制到终端执行，确认后端确实返回空数组。</li>
        </ul>
      </div>

      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <Building2 className="h-5 w-5 text-gray-700" />
          <h3 className="font-semibold text-gray-900">租户诊断</h3>
        </div>
        <button
          onClick={loadTenants}
          disabled={tenants.loading}
          className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {tenants.loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Server className="h-4 w-4" />}
          加载租户列表
        </button>
        {tenants.error && (
          <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">{tenants.error}</div>
        )}
        {tenants.data.length > 0 && (
          <div className="mt-3 space-y-2">
            {tenants.data.map((t) => (
              <div key={t.id} className="rounded-xl border border-gray-200 bg-gray-50 p-3 text-sm">
                <p><span className="font-medium">ID:</span> {t.id}</p>
                <p><span className="font-medium">名称:</span> {t.name || t.display_name || '未命名'}</p>
                {t.api_key && <p><span className="font-medium">Key:</span> {t.api_key.slice(0, 8)}…</p>}
              </div>
            ))}
          </div>
        )}
        {!tenants.loading && !tenants.error && tenants.data.length === 0 && (
          <p className="mt-2 text-xs text-gray-500">未加载到租户，请点击上方按钮。</p>
        )}
      </div>

      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical className="h-5 w-5 text-gray-700" />
          <h3 className="font-semibold text-gray-900">自定义探测</h3>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">认证头</label>
            <div className="flex gap-2">
              <button
                onClick={() => setAuthMode('xapikey')}
                className={clsx(
                  'flex-1 rounded-lg py-2 text-xs font-medium',
                  authMode === 'xapikey' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                )}
              >
                X-API-Key
              </button>
              <button
                onClick={() => setAuthMode('bearer')}
                className={clsx(
                  'flex-1 rounded-lg py-2 text-xs font-medium',
                  authMode === 'bearer' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'
                )}
              >
                Bearer Token
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">tenant_id 参数（可选）</label>
            <input
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
              placeholder="例如 1 或租户 UUID"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-700">接口路径（自动补 /api/v1）</label>
            <input
              value={customPath}
              onChange={(e) => setCustomPath(e.target.value)}
              placeholder="/knowledge-bases"
              className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={runCustomProbe}
            disabled={customLoading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {customLoading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            发送探测请求
          </button>
          {customResult && (
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-medium text-gray-700">
                  状态: {customResult.error ? '请求失败' : `${customResult.status} ${customResult.statusText}`}
                </span>
                {customResult.body && (
                  <button
                    onClick={() => copyText(customResult.body, 'custom')}
                    className="flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[10px] text-gray-600 shadow-sm"
                  >
                    {copied === 'custom' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied === 'custom' ? '已复制' : '复制'}
                  </button>
                )}
              </div>
              <p className="mb-2 text-xs text-gray-600 break-all">
                <span className="font-medium">请求 URL：</span>{customResult.url}
              </p>
              {customResult.error ? (
                <p className="text-xs text-red-700">{customResult.error}</p>
              ) : (
                <pre className="max-h-40 overflow-y-auto rounded-lg bg-gray-900 p-2 text-xs text-green-400 whitespace-pre-wrap break-words">
                  {customResult.body || '(空响应)'}
                </pre>
              )}
              {customResult.json && (
                <p className="mt-2 text-xs text-gray-600">
                  解析到列表长度: {extractList(customResult.json).length} 条
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3">
          <button
            onClick={runAll}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <RefreshCw className="h-4 w-4" /> 一键测试所有接口
          </button>
        </div>

        <div className="mt-3 space-y-2">
          {endpoints.map((ep) => {
            const r = results[ep.key];
            if (!r) {
              return (
                <button
                  key={ep.key}
                  onClick={() => runTest(ep)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-gray-50 p-3 text-left text-sm text-gray-700"
                >
                  <span>{ep.label} <span className="text-xs text-gray-400">{ep.path}</span></span>
                  <span className="text-xs text-gray-400">点击测试</span>
                </button>
              );
            }
            return (
              <div key={ep.key} className="rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {r.loading ? (
                      <RefreshCw className="h-4 w-4 animate-spin text-blue-600" />
                    ) : r.error ? (
                      <AlertCircle className="h-4 w-4 text-red-600" />
                    ) : (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    )}
                    <span className="text-sm font-medium text-gray-900">{ep.label}</span>
                    <span className="text-xs text-gray-400">{ep.path}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.count !== null && (
                      <span className={clsx(
                        'rounded-full px-2 py-0.5 text-xs',
                        r.count === 0 ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
                      )}>
                        {r.count} 条
                      </span>
                    )}
                    <button
                      onClick={() => runTest(ep)}
                      disabled={r.loading}
                      className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 disabled:opacity-50"
                    >
                      {r.loading ? '请求中…' : '重试'}
                    </button>
                  </div>
                </div>
                {r.error && (
                  <div className="mt-2 rounded-lg bg-red-50 p-2 text-xs text-red-700">
                    {r.error}
                  </div>
                )}
                {r.response !== null && (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="text-xs font-medium text-gray-700">原始响应：</p>
                      <button
                        onClick={() => copyText(JSON.stringify(r.response, null, 2), ep.key)}
                        className="flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600"
                      >
                        {copied === ep.key ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied === ep.key ? '已复制' : '复制'}
                      </button>
                    </div>
                    <pre className="max-h-40 overflow-y-auto rounded-lg bg-gray-900 p-2 text-xs text-green-400 whitespace-pre-wrap break-words">
                      {JSON.stringify(r.response, null, 2)}
                    </pre>
                  </div>
                )}
                {r.response !== null && r.count === 0 && (
                  <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-700">
                    后端返回的 data 为空数组。请检查 API Key 是否对应网页端所在的租户。
                  </div>
                )}
                {r.response !== null && (
                  <div className="mt-2">
                    <p className="mb-1 text-xs font-medium text-gray-700">
                      <Terminal className="inline h-3 w-3 mr-1" />
                      curl 命令（可直接复制到终端测试）：
                    </p>
                    <div className="relative">
                      <pre className="max-h-32 overflow-y-auto rounded-lg bg-gray-100 p-2 text-xs text-gray-700 whitespace-pre-wrap break-words">
                        {buildCurl(ep.path, authMode, getConfig().apiKey)}
                      </pre>
                      <button
                        onClick={() => copyText(buildCurl(ep.path, authMode, getConfig().apiKey), `curl-${ep.key}`)}
                        className="absolute right-2 top-2 flex items-center gap-1 rounded bg-white px-2 py-0.5 text-[10px] text-gray-600 shadow-sm"
                      >
                        {copied === `curl-${ep.key}` ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied === `curl-${ep.key}` ? '已复制' : '复制'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900">请求日志</h3>
        <button
          onClick={() => { clearLogs(); refresh(); }}
          className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700"
        >
          <Trash2 className="h-3.5 w-3.5" /> 清空
        </button>
      </div>

      <div className="space-y-2">
        {logs.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">暂无日志，请先测试连接或刷新页面</p>
        )}
        {logs.slice().reverse().map((log) => {
          const isReq = log.type === 'request';
          return (
            <div key={log.id} className="rounded-2xl bg-white p-3 shadow-sm">
              <button
                onClick={() => toggle(log.id)}
                className="flex w-full items-center justify-between text-left"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={clsx(
                      'rounded px-1.5 py-0.5 text-[10px] font-medium',
                      isReq ? 'bg-blue-50 text-blue-600' : log.status >= 400 || log.status === 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'
                    )}
                  >
                    {isReq ? 'REQ' : `RES ${log.status || 'ERR'}`}
                  </span>
                  <span className="text-xs text-gray-500">{new Date(log.time).toLocaleTimeString()}</span>
                  <span className="text-xs text-gray-700">{isReq ? log.method : log.statusText}</span>
                </div>
                {expanded[log.id] ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>
              {expanded[log.id] && (
                <div className="mt-2 space-y-2 border-t border-gray-100 pt-2">
                  {!isReq && log.ref && (
                    <p className="text-[10px] text-gray-400">关联请求 ID: {log.ref}</p>
                  )}
                  {isReq && (
                    <>
                      <p className="text-xs text-gray-600"><span className="font-medium">URL:</span> {log.url}</p>
                      <p className="text-xs text-gray-600"><span className="font-medium">Headers:</span> {JSON.stringify(log.headers)}</p>
                      <p className="text-xs text-gray-600"><span className="font-medium">Body:</span> {log.body}</p>
                    </>
                  )}
                  {!isReq && (
                    <>
                      <p className="text-xs text-gray-600"><span className="font-medium">Body:</span></p>
                      <pre className="max-h-40 overflow-y-auto rounded-lg bg-gray-50 p-2 text-xs text-gray-700 break-words whitespace-pre-wrap">
                        {log.body}
                      </pre>
                      {log.error && <p className="text-xs text-red-600">Error: {log.error}</p>}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default Diagnostics;
