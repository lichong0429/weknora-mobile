import { useState, useEffect } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { System as SystemAPI } from '../api/endpoints.js';
import { useConfig } from '../contexts/ConfigContext.jsx';
import {
  Loader2, AlertCircle, RefreshCw, Server, HardDrive, FileText,
  CheckCircle, XCircle, Activity, Info, ChevronDown, ChevronUp,
  Settings2, ArrowRightCircle
} from 'lucide-react';
import { clsx } from 'clsx';

function InfoCard({ title, icon: Icon, children }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-5 w-5 text-blue-600" />
        <h3 className="font-semibold text-gray-900">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function RawResponse({ data, label }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? '隐藏' : '查看'}原始响应{label ? `（${label}）` : ''}
      </button>
      {open && (
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-gray-900 p-2 text-xs text-gray-100">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

// Try to extract a list from various response shapes and normalize fields
function extractList(res, fallbackKeys = []) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.data)) return res.data;
  if (Array.isArray(res.items)) return res.items;
  if (Array.isArray(res.list)) return res.list;
  for (const key of fallbackKeys) {
    if (Array.isArray(res[key])) return res[key];
    if (res.data && Array.isArray(res.data[key])) return res.data[key];
  }
  return [];
}

function normalizeEngine(item) {
  if (!item || typeof item !== 'object') return null;
  const name = item.name || item.id || item.engine || item.provider || '未知';
  const label = item.label || item.title || item.display_name || name;
  const description = item.description || item.desc || item.note || '';
  const available =
    item.available === true ||
    item.enabled === true ||
    item.status === 'available' ||
    item.status === 'enabled' ||
    item.status === 'ok' ||
    item.status === true ||
    item.active === true ||
    item.healthy === true;
  const addr = item.addr || item.address || item.endpoint || item.url || '';
  return { ...item, name, label, description, available, addr };
}

function SystemInfo() {
  const { config } = useConfig();
  const { data: info, loading: infoLoading, error: infoError, run: runInfo } = useAsync(() => SystemAPI.info(), [config.baseUrl, config.apiKey]);
  const { data: parsers, loading: parserLoading, error: parserError, run: runParser } = useAsync(() => SystemAPI.parserEngines(), [config.baseUrl, config.apiKey]);
  const { data: storage, loading: storageLoading, error: storageError, run: runStorage } = useAsync(() => SystemAPI.storageEngineStatus(), [config.baseUrl, config.apiKey]);

  const [checking, setChecking] = useState({});
  const [checkResults, setCheckResults] = useState({});
  const [mounted, setMounted] = useState(false);
  const [storageModal, setStorageModal] = useState(false);
  const [settingEngine, setSettingEngine] = useState(null);
  const [setEngineResult, setSetEngineResult] = useState(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const parserEngines = extractList(parsers, ['engines', 'parsers']).map(normalizeEngine).filter(Boolean);
  const storageRoot = storage?.data || storage || {};
  const storageEngines = extractList(storageRoot, ['engines', 'storages']).map(normalizeEngine).filter(Boolean);
  const currentStorageEngine = storageRoot.current_engine || storageRoot.current || storageRoot.active_engine || storageEngines.find(e => e.available)?.name || '-';

  const handleCheckParser = async (engine) => {
    setChecking((p) => ({ ...p, [engine.name]: true }));
    try {
      const res = await SystemAPI.checkParserEngine({ name: engine.name, addr: engine.addr });
      setCheckResults((r) => ({ ...r, [engine.name]: res.success }));
    } catch {
      setCheckResults((r) => ({ ...r, [engine.name]: false }));
    } finally {
      setChecking((p) => ({ ...p, [engine.name]: false }));
    }
  };

  const handleReconnect = async () => {
    try {
      await SystemAPI.reconnectDocreader({});
      alert('重连请求已发送');
      runParser();
    } catch (err) {
      alert(err.message || '重连失败');
    }
  };

  const handleCheckStorage = async (engine) => {
    setChecking((p) => ({ ...p, [engine.name]: true }));
    try {
      const res = await SystemAPI.checkStorageEngine({ provider: engine.name });
      setCheckResults((r) => ({ ...r, [engine.name]: res.success }));
    } catch {
      setCheckResults((r) => ({ ...r, [engine.name]: false }));
    } finally {
      setChecking((p) => ({ ...p, [engine.name]: false }));
    }
  };

  const handleSetStorageEngine = async (engine) => {
    setSettingEngine(engine.name);
    setSetEngineResult(null);
    try {
      // WeKnora may not expose this endpoint; try gracefully
      const res = await SystemAPI.setStorageEngine?.({ provider: engine.name });
      if (res?.success) {
        setSetEngineResult({ type: 'success', message: `已切换为 ${engine.label || engine.name}` });
        runStorage();
      } else {
        throw new Error('后端未返回成功状态');
      }
    } catch (err) {
      setSetEngineResult({
        type: 'info',
        message: '当前 WeKnora 版本不支持通过 API 直接切换存储引擎。请在 WeKnora 服务器的环境变量或管理后台中修改默认存储引擎配置，然后重启服务。'
      });
    } finally {
      setSettingEngine(null);
    }
  };

  if (!mounted) {
    return (
      <div className="p-4">
        <h2 className="text-xl font-bold text-gray-900">系统信息</h2>
        <div className="mt-8 flex justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">系统信息</h2>
        <button
          type="button"
          onClick={() => { runInfo(); runParser(); runStorage(); }}
          className="rounded-full p-2 text-gray-600 hover:bg-gray-100"
          aria-label="刷新"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      </div>

      <div className="space-y-4">
        <InfoCard title="版本信息" icon={Activity}>
          {infoLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : infoError ? (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">加载失败</p>
                <p className="mt-1">{infoError}</p>
              </div>
            </div>
          ) : info?.data ? (
            <div className="space-y-1 text-sm text-gray-700">
              <p>版本：{info.data.version || '-'}</p>
              <p>类型：{info.data.edition || '-'}</p>
              <p>构建：{info.data.build_time || '-'}</p>
              <p>Go 版本：{info.data.go_version || '-'}</p>
              <p>向量引擎：{info.data.vector_store_engine || '-'}</p>
              <p>关键词引擎：{info.data.keyword_index_engine || '-'}</p>
              <p>图数据库：{info.data.graph_database_engine || '-'}</p>
              <p>MinIO：{info.data.minio_enabled ? '启用' : '未启用'}</p>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">暂无版本信息</p>
                <p className="mt-1">后端返回了空数据，或当前 WeKnora 版本未开放 /system/info 接口。</p>
              </div>
            </div>
          )}
          <RawResponse data={info} label="/system/info" />
        </InfoCard>

        <InfoCard title="解析引擎" icon={FileText}>
          {parserLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : parserError ? (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">加载失败</p>
                <p className="mt-1">{parserError}</p>
              </div>
            </div>
          ) : parserEngines.length > 0 ? (
            <div className="space-y-3">
              {parsers.connected !== undefined && (
                <div className={clsx('flex items-center gap-2 rounded-xl px-3 py-2 text-xs', parsers.connected ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>
                  <Server className="h-4 w-4" />
                  解析服务状态：{parsers.connected ? '已连接' : '未连接'}
                </div>
              )}
              {parserEngines.map((engine) => (
                <div key={engine.name} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{engine.label || engine.name}</p>
                      <p className="text-xs text-gray-500">{engine.description || '无描述'}</p>
                      {engine.addr && <p className="text-xs text-gray-400">{engine.addr}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {engine.available ? (
                        <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">可用</span>
                      ) : (
                        <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">不可用</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCheckParser(engine)}
                      disabled={checking[engine.name]}
                      className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-blue-700 shadow-sm disabled:opacity-50"
                    >
                      {checking[engine.name] ? '检测中…' : '检测'}
                    </button>
                    {engine.name === 'docreader' && (
                      <button
                        type="button"
                        onClick={handleReconnect}
                        className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-gray-700 shadow-sm"
                      >
                        重连
                      </button>
                    )}
                    {checkResults[engine.name] !== undefined && (
                      checkResults[engine.name] ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">暂无解析引擎</p>
                <p className="mt-1">后端返回了空列表，或当前 WeKnora 版本未开放 /system/parser-engines 接口。</p>
              </div>
            </div>
          )}
          <RawResponse data={parsers} label="/system/parser-engines" />
        </InfoCard>

        <InfoCard title="存储引擎" icon={HardDrive}>
          {storageLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          ) : storageError ? (
            <div className="flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">加载失败</p>
                <p className="mt-1">{storageError}</p>
              </div>
            </div>
          ) : storageEngines.length > 0 ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4" />
                  当前存储引擎：{currentStorageEngine}
                </div>
                <button
                  type="button"
                  onClick={() => setStorageModal(true)}
                  className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 font-medium text-blue-700 shadow-sm"
                >
                  <Settings2 className="h-3 w-3" /> 切换 / 配置
                </button>
              </div>
              {storageRoot.minio_env_available !== undefined && (
                <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  <HardDrive className="h-4 w-4" />
                  MinIO 环境配置：{storageRoot.minio_env_available ? '可用' : '不可用'}
                </div>
              )}
              {storageEngines.map((engine) => (
                <div key={engine.name} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{engine.label || engine.name}</p>
                      <p className="text-xs text-gray-500">{engine.description || '无描述'}</p>
                      {engine.addr && <p className="text-xs text-gray-400">{engine.addr}</p>}
                    </div>
                    <span className={clsx('rounded-full px-2 py-0.5 text-xs', engine.available ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-600')}>
                      {engine.available ? '可用' : '不可用'}
                    </span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCheckStorage(engine)}
                      disabled={checking[engine.name]}
                      className="rounded-lg bg-white px-2 py-1 text-xs font-medium text-blue-700 shadow-sm disabled:opacity-50"
                    >
                      {checking[engine.name] ? '检测中…' : '检测连通性'}
                    </button>
                    {checkResults[engine.name] !== undefined && (
                      checkResults[engine.name] ? (
                        <CheckCircle className="h-4 w-4 text-green-600" />
                      ) : (
                        <XCircle className="h-4 w-4 text-red-600" />
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-xl bg-gray-50 p-3 text-sm text-gray-600">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">暂无存储引擎</p>
                <p className="mt-1">后端返回了空列表，或当前 WeKnora 版本未开放 /system/storage-engine-status 接口。</p>
              </div>
            </div>
          )}
          <RawResponse data={storage} label="/system/storage-engine-status" />
        </InfoCard>
      </div>

      {storageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <div className="mb-4 flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-blue-600" />
              <h3 className="text-lg font-bold text-gray-900">存储引擎配置</h3>
            </div>
            <p className="mb-4 text-sm text-gray-600">
              当前生效的存储引擎：<span className="font-medium text-gray-900">{currentStorageEngine}</span>
            </p>
            <div className="space-y-2 max-h-64 overflow-auto">
              {storageEngines.map((engine) => (
                <div
                  key={engine.name}
                  className={clsx(
                    'flex items-center justify-between rounded-xl border p-3',
                    currentStorageEngine === engine.name ? 'border-blue-300 bg-blue-50' : 'border-gray-100 bg-gray-50'
                  )}
                >
                  <div>
                    <p className="font-medium text-gray-900">{engine.label || engine.name}</p>
                    <p className="text-xs text-gray-500">{engine.description || '无描述'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSetStorageEngine(engine)}
                    disabled={settingEngine === engine.name}
                    className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium text-blue-700 shadow-sm disabled:opacity-50"
                  >
                    {settingEngine === engine.name ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ArrowRightCircle className="h-3 w-3" />
                    )}
                    使用
                  </button>
                </div>
              ))}
            </div>
            {setEngineResult && (
              <div className={clsx('mt-4 rounded-xl p-3 text-sm', setEngineResult.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-blue-50 text-blue-700')}>
                {setEngineResult.message}
              </div>
            )}
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => { setStorageModal(false); setSetEngineResult(null); }}
                className="rounded-xl bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SystemInfo;
