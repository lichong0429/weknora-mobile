import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { login as apiLogin, fetchMe, switchToApiKeyMode } from '../api/auth.js';
import { get } from '../api/client.js';
import { getConfig, setConfig } from '../config.js';
import { resolveAuthMode, AUTH_MODE_ACCOUNT } from '../utils/auth.js';
import {
  Globe, Key, LogIn, Eye, EyeOff, AlertCircle, CheckCircle,
  UserCircle, Loader2, ShieldCheck
} from 'lucide-react';

/**
 * 登录 / 凭据配置页。
 *
 * 为什么需要它：原来 App 没有任何登录概念，全靠手动填 API Key，
 * 换 Key 得进设置页；账号密码方式更是完全缺失。
 *
 * 两种方式**并存**，可随时切换：
 *   - 账号密码：填邮箱 + 密码 → /auth/login 换 JWT（可自动续期）
 *   - API Key：直接填 key（适合服务未开注册、或内网只发 key 的场景）
 */
function Login() {
  const navigate = useNavigate();
  const cfg = getConfig();

  // 首次进入若已有可用凭据，直接放行（不打扰已配置的用户）
  const [mode, setMode] = useState(() => {
    const cur = resolveAuthMode(cfg);
    return cur === AUTH_MODE_ACCOUNT ? 'account' : 'apikey';
  });
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl || 'http://localhost:8080');
  const [email, setEmail] = useState(cfg.authEmail || '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState(cfg.apiKey || '');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);

  useEffect(() => {
    // 地址先落盘：登录请求要用它，而登录成功后才能进主界面
    if (baseUrl !== cfg.baseUrl) setConfig({ baseUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  const handleAccountLogin = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await apiLogin({ email, password, baseUrl });
      // 立刻验证凭据真的可用：登录接口成功 ≠ 后续业务接口有权限
      const me = await fetchMe();
      setStatus({
        type: 'success',
        message: `已登录：${me?.user?.username || email}${r.tenantName ? `（空间：${r.tenantName}）` : ''}`
      });
      navigate('/', { replace: true });
    } catch (err) {
      setStatus({ type: 'error', message: err.message || '登录失败' });
    } finally {
      setBusy(false);
    }
  };

  const handleApiKeySave = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', message: '请输入 API Key' });
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      switchToApiKeyMode(apiKey.trim());
      // 真实拉一次接口：填了不等于对
      await get('/knowledge-bases?page=1&page_size=1');
      setStatus({ type: 'success', message: 'API Key 有效' });
      navigate('/', { replace: true });
    } catch (err) {
      // 别把已保存的无效 key 留在配置里，否则下次进来还是坏的
      setConfig({ authMode: 'apikey', apiKey: '' });
      setApiKey('');
      setStatus({ type: 'error', message: err.message || 'API Key 无效' });
    } finally {
      setBusy(false);
    }
  };

  const canSubmit = mode === 'account'
    ? (email.trim() && password && baseUrl.trim())
    : (apiKey.trim() && baseUrl.trim());

  return (
    <div className="flex min-h-screen flex-col justify-center bg-surface-soft px-5 py-8">
      <div className="mx-auto w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-500 text-white shadow-sm">
            <UserCircle className="h-8 w-8" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">登录 WeKnora</h1>
          <p className="mt-1 text-sm text-gray-500">支持账号密码登录，也可用 API Key</p>
        </div>

        {/* 方式切换：显式两栏，不藏进「更多」——两种都是常用路径 */}
        <div className="mb-4 flex gap-2 rounded-2xl bg-white p-1.5 shadow-sm">
          {[
            { key: 'account', label: '账号密码', icon: UserCircle },
            { key: 'apikey', label: 'API Key', icon: Key }
          ].map((t) => {
            const Icon = t.icon;
            const active = mode === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => { setMode(t.key); setStatus(null); }}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
              <Globe className="h-4 w-4" /> WeKnora 地址
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://192.168.1.10:8080"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-500">不要加 /api/v1</p>
          </div>

          {mode === 'account' ? (
            <>
              <div>
                <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <UserCircle className="h-4 w-4" /> 邮箱 / 账号
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <ShieldCheck className="h-4 w-4" /> 密码
                </label>
                <div className="relative">
                  <input
                    type={showSecret ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleAccountLogin(); }}
                    placeholder="••••••••"
                    className="w-full rounded-xl border border-gray-300 px-3 py-2.5 pr-11 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSecret((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-400 hover:text-gray-600"
                    aria-label={showSecret ? '隐藏密码' : '显示密码'}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  密码仅用于换取访问令牌，不会保存在本机
                </p>
              </div>
            </>
          ) : (
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
                <Key className="h-4 w-4" /> API Key
              </label>
              <input
                type={showSecret ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleApiKeySave(); }}
                placeholder="wk-..."
                autoCapitalize="none"
                autoCorrect="off"
                className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-gray-500">在 WeKnora 账户信息页获取</p>
            </div>
          )}

          {status && (
            <div
              className={clsx(
                'flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
                status.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
              )}
            >
              {status.type === 'success'
                ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="break-words">{status.message}</span>
            </div>
          )}

          <button
            type="button"
            disabled={!canSubmit || busy}
            onClick={mode === 'account' ? handleAccountLogin : handleApiKeySave}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {busy ? '验证中…' : (mode === 'account' ? '登录' : '保存并进入')}
          </button>

          {mode === 'account' && (
            <p className="text-center text-xs leading-relaxed text-gray-400">
              账号需先在 WeKnora 网页端注册
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;