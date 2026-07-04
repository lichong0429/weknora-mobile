import { useState, useEffect } from 'react';
import { useAsync } from '../hooks/useApi.js';
import { System as SystemAPI } from '../api/endpoints.js';
import { useConfig } from '../contexts/ConfigContext.jsx';
import {
  Loader2, AlertCircle, RefreshCw, Server, HardDrive, FileText,
  CheckCircle, XCircle, Activity, Info
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

function SystemInfo() {
  const { config } = useConfig();
  const { data: info, loading: infoLoading, error: infoError, run: runInfo } = useAsync(() => SystemAPI.info(), [config.baseUrl, config.apiKey]);
  const { data: parsers, loading: parserLoading, error: parserError, run: runParser } = useAsync(() => SystemAPI.parserEngines(), [config.baseUrl, config.apiKey]);
  const { data: storage, loading: storageLoading, error: storageError, run: runStorage } = useAsync(() => SystemAPI.storageEngineStatus(), [config.baseUrl, config.apiKey]);

  const [checking, setChecking] = useState({});
  const [checkResults, setCheckResults] = useState({});
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
          ) : (parsers?.data || []).length > 0 ? (
            <div className="space-y-3">
              {parsers.connected !== undefined && (
                <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  <Server className="h-4 w-4" />
                  解析服务状态：{parsers.connected ? '已连接' : '未连接'}
                </div>
              )}
              {(parsers?.data || []).map((engine) => (
                <div key={engine.name} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{engine.label || engine.name}</p>
                      <p className="text-xs text-gray-500">{engine.description || engine.name}</p>
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
          ) : (storage?.data?.engines || []).length > 0 ? (
            <div className="space-y-3">
              {storage.data.minio_env_available !== undefined && (
                <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-xs text-blue-700">
                  <HardDrive className="h-4 w-4" />
                  MinIO 环境配置：{storage.data.minio_env_available ? '可用' : '不可用'}
                </div>
              )}
              {(storage?.data?.engines || []).map((engine) => (
                <div key={engine.name} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-gray-900">{engine.label || engine.name}</p>
                      <p className="text-xs text-gray-500">{engine.description || engine.name}</p>
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
        </InfoCard>
      </div>
    </div>
  );
}

export default SystemInfo;
