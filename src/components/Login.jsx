import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { login as apiLogin, fetchMe, switchToApiKeyMode } from '../api/auth.js';
import { get, buildUrl } from '../api/client.js';
import { getConfig, setConfig } from '../config.js';
import { resolveAuthMode, AUTH_MODE_ACCOUNT } from '../utils/auth.js';
import {
  Globe, Key, LogIn, Eye, EyeOff, AlertCircle, CheckCircle,
  UserCircle, Loader2, ShieldCheck, Plug, Save, RefreshCw
} from 'lucide-react';

/**
 * 登录 / 凭据配置页。
 *
 * 两个方式**并存**，可随时切换：
 *   - 账号密码：填邮箱 + 密码 → /auth/login 换 JWT（可自动续期）
 *   - API Key：直接填 key（适合服务未开注册、或内网只发 key 的场景）
 *
 * 【v1.9.2】按用户要求拆成三个动作，避免"点了没反应也不知道成没成功"：
 *   1. 测试连接 —— 只探测地址可达 + 该地址是否提供账号登录接口，不写入任何凭据
 *   2. 登录并保存 —— 真正换 token、落盘，并显示可核验的登录身份
 *   3. 状态回显 —— 明确显示当前是否已登录、用的哪种方式、账号是谁
 */
function Login() {
  const navigate = useNavigate();
  const cfg = getConfig();

  const [mode, setMode] = useState(() => {
    const cur = resolveAuthMode(cfg);
    return cur === AUTH_MODE_ACCOUNT ? 'account' : 'apikey';
  });
  const [baseUrl, setBaseUrl] = useState(cfg.baseUrl || 'http://localhost:8080');
  const [email, setEmail] = useState(cfg.authEmail || '');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState(cfg.apiKey || '');
  const [showSecret, setShowSecret] = useState(false);
  const [busy, setBusy] = useState('');        // '' | 'test' | 'login'
  const [status, setStatus] = useState(null);

  // 登录成功后的身份信息（可核验，不再"不知道到底登录没登录"）
  const [identity, setIdentity] = useState(() => (
    resolveAuthMode(cfg) === AUTH_MODE_ACCOUNT && cfg.authToken
      ? {
          username: cfg.authUser?.username || cfg.authEmail || '已登录',
          email: cfg.authUser?.email || cfg.authEmail || '',
          tenant: cfg.authTenantName || '',
          token: cfg.authToken
        }
      : null
  ));

  useEffect(() => {
    // 地址先落盘：登录与测试都要用它，而成功后才能进主界面。
    // 现在 setConfig 是「合并」语义，不会再抹掉已有凭据。
    if (baseUrl !== cfg.baseUrl) setConfig({ baseUrl });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl]);

  // ---- ① 测试连接：只探测，不写凭据 ----
  const handleTest = async () => {
    if (!baseUrl.trim()) {
      setStatus({ type: 'error', message: '请先填写 WeKnora 地址' });
      return;
    }
    setBusy('test');
    setStatus(null);
    try {
      setConfig({ baseUrl: baseUrl.trim() });
      const url = buildUrl('/knowledge-bases?page=1&page_size=1');
      const started = Date.now();
      // 用当前已保存的凭据试一次（未登录时就是匿名，应当 401 —— 那是"地址对"的证据）
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      const ms = Date.now() - started;
      if (res.ok) {
        setStatus({ type: 'success', message: `地址可用（${ms} ms），当前凭据也能正常读取数据` });
      } else if (res.status === 401 || res.status === 403) {
        setStatus({ type: 'success', message: `地址可用（${ms} ms）。未登录/凭据无效属预期，可继续登录` });
      } else {
        setStatus({ type: 'warn', message: `地址可达但返回 HTTP ${res.status}，请确认端口与路径是否正确` });
      }
      // 额外探测：该版本是否提供账号登录
      try {
        const r2 = await fetch(buildUrl('/auth/login'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: '__probe__', password: '__probe__' })
        });
        if (r2.status === 404) {
          setStatus((s) => ({
            type: s?.type || 'warn',
            message: `${s?.message || ''}\n该服务未提供 /auth/login（可能版本过旧），请改用 API Key 登录。`.trim()
          }));
        } else if (r2.ok || r2.status === 401 || r2.status === 400) {
          setStatus((s) => ({
            type: s?.type || 'success',
            message: `${s?.message || ''}\n该服务支持账号登录（/auth/login 可用）。`.trim()
          }));
        }
      } catch { /* 探测失败不影响主结论 */ }
    } catch (err) {
      setStatus({
        type: 'error',
        message: `无法连接：${err.message || '网络错误'}。请检查地址、端口与网络（不要加 /api/v1）`
      });
    } finally {
      setBusy('');
    }
  };

  // ---- ② 账号密码登录并保存 ----
  const handleAccountLogin = async () => {
    if (!email.trim() || !password) {
      setStatus({ type: 'error', message: '请填写邮箱与密码' });
      return;
    }
    setBusy('login');
    setStatus(null);
    try {
      const r = await apiLogin({ email, password, baseUrl: baseUrl.trim() });
      // 立刻验证凭据真的可用：登录接口成功 ≠ 后续业务接口有权限
      const me = await fetchMe();
      if (!me) {
        // 拿到了 token 却读不到 /auth/me —— 多半是版本不支持该端点，
        // 但 token 有效，仍可继续使用，只是无法显示身份
        setIdentity({
          username: email.trim(), email: email.trim(),
          tenant: r.tenantName || '', token: r ? '' : ''
        });
        setStatus({ type: 'warn', message: `已保存登录信息：${email.trim()}（该服务未提供 /auth/me，无法显示昵称）` });
      } else {
        setIdentity({
          username: me.user?.username || email.trim(),
          email: me.user?.email || email.trim(),
          tenant: (r.tenantName || '') || (me.tenant?.name || ''),
          token: ''
        });
        setStatus({
          type: 'success',
          message: `登录成功：${me.user?.username || email.trim()}${r.tenantName ? `（空间：${r.tenantName}）` : ''}`
        });
      }
      // 不立刻跳转：让用户看清"到底登录成功没有"，由他决定何时进入
    } catch (err) {
      setIdentity(null);
      setStatus({ type: 'error', message: `登录失败：${err.message || '未知错误'}` });
    } finally {
      setBusy('');
    }
  };

  // ---- ③ API Key：测试 + 保存 ----
  const handleApiKeySave = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', message: '请输入 API Key' });
      return;
    }
    setBusy('login');
    setStatus(null);
    try {
      setConfig({ baseUrl: baseUrl.trim() });
      switchToApiKeyMode(apiKey.trim());
      // 真实拉一次接口：填了不等于对
      await get('/knowledge-bases?page=1&page_size=1');
      setIdentity(null);
      setStatus({ type: 'success', message: 'API Key 有效，已保存' });
    } catch (err) {
      // 别把已保存的无效 key 留在配置里，否则下次进来还是坏的
      setConfig({ apiKey: '' });
      setApiKey('');
      setStatus({ type: 'error', message: `API Key 无效：${err.message || '读取失败'}` });
    } finally {
      setBusy('');
    }
  };

  const busyAny = busy !== '';
  const canLogin = mode === 'account'
    ? (email.trim() && password && baseUrl.trim() && !busyAny)
    : (apiKey.trim() && baseUrl.trim() && !busyAny);

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

        {/* 当前登录状态：明确回答"到底登录了没有" */}
        {identity && (
          <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-green-800">已登录（账号密码）</p>
                <p className="mt-0.5 truncate text-xs text-green-700">{identity.username}</p>
                {identity.email && identity.email !== identity.username && (
                  <p className="truncate text-xs text-green-700">{identity.email}</p>
                )}
                {identity.tenant && <p className="text-xs text-green-700">空间：{identity.tenant}</p>}
                <button
                  type="button"
                  onClick={() => navigate('/', { replace: true })}
                  className="mt-2 w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  进入应用
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 方式切换 */}
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
              placeholder="http://<你的服务器地址>:8080"
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-500">不要加 /api/v1</p>
          </div>

          {/* ① 测试连接 —— 独立按钮，不写入凭据 */}
          <button
            type="button"
            onClick={handleTest}
            disabled={busyAny || !baseUrl.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {busy === 'test' ? '测试中…' : '测试连接'}
          </button>

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
                <p className="mt-1 text-xs text-gray-500">密码仅用于换取访问令牌，不会保存在本机</p>
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
                'flex items-start gap-2 whitespace-pre-line rounded-xl px-3 py-2 text-sm',
                status.type === 'success' ? 'bg-green-50 text-green-700'
                  : status.type === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'
              )}
            >
              {status.type === 'success' ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
              <span className="break-words">{status.message}</span>
            </div>
          )}

          {/* ② 登录并保存 —— 成功后就地显示身份，由用户决定是否进入 */}
          <button
            type="button"
            disabled={!canLogin}
            onClick={mode === 'account' ? handleAccountLogin : handleApiKeySave}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {busy === 'login' ? <Loader2 className="h-4 w-4 animate-spin" />
              : mode === 'account' ? <LogIn className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {busy === 'login' ? '验证中…' : (mode === 'account' ? '登录并保存' : '保存并使用')}
          </button>

          {identity && (
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
            >
              <LogIn className="h-4 w-4" /> 进入应用
            </button>
          )}

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
