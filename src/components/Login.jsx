import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { login as apiLogin, fetchMe, switchToApiKeyMode } from '../api/auth.js';
import { get, buildUrl } from '../api/client.js';
import { getConfig, setConfig } from '../config.js';
import { resolveAuthMode, AUTH_MODE_ACCOUNT } from '../utils/auth.js';
import {
  isAvailable as secureIsAvailable,
  save as secureSave,
  load as secureLoad,
  clear as secureClear,
  CODE_DECRYPT_FAILED,
  CODE_BAD_INPUT
} from '../utils/secureStore.js';

// 纯决策函数住在独立的 .js 模块里：Node 能直接 import 做断言（.jsx 不行），
// 同时 Login.jsx 只剩组件导出，Fast Refresh 不会退化成整页刷新。
import { planRestore } from '../utils/baseUrlIdentity.js';
import { planSaveToggle, planStaleCredential } from '../utils/loginPolicy.js';
import { noticeText } from '../utils/noticeText.js';
import {
  Globe, Key, LogIn, Eye, EyeOff, AlertCircle, CheckCircle,
  UserCircle, Loader2, ShieldCheck, Plug, Save, RefreshCw, Lock
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
 *
 * 【保存密码】密码只走**原生 Keystore 加密通道**（utils/secureStore.js），
 * 绝不回落 localStorage（那条红线在 secureStore 的测试里有断言）：
 *   - 勾选框状态持久化在配置的 `savePassword`（默认 true），**只有登录成功才写盘**；
 *   - 挂载时 load() 一次并回填，回填成功后进入「已保存」状态，提供「清除」入口；
 *   - 四个 code 各有各的处理：EMPTY 静默 / BAD_INPUT 清掉后静默 /
 *     DECRYPT_FAILED 清掉并提示重输 / UNAVAILABLE 不报错（无桥环境是常态）；
 *   - 登录返回 401 视为「已存密码已失效」→ 清掉密文、取消勾选、清空密码、聚焦密码框；
 *   - 任何存储失败都**不阻断登录**，只记录（登录成功与否只由服务端回答）。
 */
function Login() {
  const navigate = useNavigate();
  const { t } = useI18n();
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
  // 原生安全存储是否可用（同步判断，桥在页面加载前就注入好了，所以只需算一次）
  const [secureAvailable] = useState(() => secureIsAvailable());
  // 勾选框状态跟配置走（savePassword 默认 true），关掉时立刻清掉本机密文
  const [savePassword, setSavePassword] = useState(() => cfg.savePassword !== false);
  // 「用户此刻是否要求保存密码」的最新值。
  //
  // 为什么不能只读 state：`persistPassword()` 是登录成功后 await 回来的**旧闭包**，
  // 里面捕获的 `savePassword` 是发起登录那一刻的值。用户在请求在途期间取消勾选，
  // state 变了、闭包没变 —— 结果「勾选框=关」但仍把密码写盘（QA 实测的 RISK）。
  // 所以判断一律走 ref，且**在事件处理器里同步写**（早于任何 await / setState 提交）。
  const savePasswordRef = useRef(savePassword);
  // 兜底：任何遗漏的 setSavePassword 也会在同一次渲染提交后把 ref 对齐
  useEffect(() => { savePasswordRef.current = savePassword; }, [savePassword]);
  // 是否处于「本机已存有凭据」状态 —— 决定要不要显示「清除」入口
  const [hasSavedPassword, setHasSavedPassword] = useState(false);
  // 密文里记录的「服务器地址」。401 时要拿它与**当前**地址重新比一次：
  // hasSavedPassword 描述的是上次 load() 那一刻的判定，用户之后可能改过地址。
  const [savedServerUrl, setSavedServerUrl] = useState('');
  // 保存密码通道自己的提示（与「登录状态」分开，避免它把登录结果覆盖掉）
  const [secureNotice, setSecureNotice] = useState(null);
  // 401 回退后要把焦点送回密码框（用户下一步必然是重输密码）
  const passwordRef = useRef(null);

  // 登录成功后的身份信息（可核验，不再"不知道到底登录没登录"）
  const [identity, setIdentity] = useState(() => (
    resolveAuthMode(cfg) === AUTH_MODE_ACCOUNT && cfg.authToken
      ? {
          // 这里刻意不存 t(...) 的结果：翻译快照切语言后不会更新。留空，渲染处兜底。
          username: cfg.authUser?.username || cfg.authEmail || '',
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

  // 挂载时读一次「已保存的密码」并回填（**绝不自动提交登录**）。
  //
  // 四个 code 必须分开处理 —— 混成一个分支会让第一次启动就弹红条：
  //   ok              → 回填 email/password/baseUrl，进入「已保存」状态
  //   EMPTY           → 从没保存过，正常路径，**静默**
  //   BAD_INPUT       → 数据残缺/协议失配 → clear() 收尾后静默（不留脏数据）
  //   DECRYPT_FAILED  → 密钥失效或密文损坏 → clear() + 提示重输，**不重试**
  //   UNAVAILABLE     → 无桥环境（浏览器/PWA）是常态 → 静默，用户还没要求保存
  useEffect(() => {
    if (!secureAvailable) return undefined;
    let cancelled = false;
    (async () => {
      const res = await secureLoad();
      if (cancelled) return;
      if (res.ok) {
        // 关键安全判定：密码只在「同一台服务器」时回填（详见 planRestore 注释）。
        // 这里**绝不调用 setBaseUrl** —— 回填不能改变当前服务器地址，
        // 否则用户重开 App 会被静默指回上一次保存密码的那台机器。
        const plan = planRestore({ savedBaseUrl: res.data.baseUrl, currentBaseUrl: cfg.baseUrl });
        setEmail((prev) => prev || res.data.email);
        if (plan.fillPassword) setPassword((prev) => prev || res.data.password);
        savePasswordRef.current = true;
        setSavePassword(true);
        // 注意：跨站时也会置 true —— 「本机确实存着一份凭据」是事实，
        // 「清除」入口必须能点到。因此 401 回退不能只看这个标志，
        // 还要靠 planStaleCredential 的 sameServerNow 再做一次地址比较。
        setHasSavedPassword(true);
        setSavedServerUrl(res.data.baseUrl || '');
        // 提示分流：同源 → 已保存；异源 → 告诉用户那份密码属于哪台。
        // 若密文里没有可用地址（异常数据），host 为空 —— 此时既不能谎称同源，
        // 也不能渲染出「属于 ，与当前服务器不同」这种残句，只静默 + 留痕。
        if (plan.sameServer) {
          setSecureNotice({ type: 'info', key: 'login.secureSaved' });
        } else if (plan.host) {
          setSecureNotice({ type: 'warn', key: 'login.secureOtherServer', params: { host: plan.host } });
        } else {
          setSecureNotice(null);
          console.warn('[secureStore] saved credential has no usable baseUrl');
        }
      } else if (res.code === CODE_DECRYPT_FAILED) {
        await secureClear();
        if (cancelled) return;
        savePasswordRef.current = false;
        setSavePassword(false);
        setHasSavedPassword(false);
        setSecureNotice({ type: 'warn', key: 'login.secureExpired' });
      } else if (res.code === CODE_BAD_INPUT) {
        await secureClear();
        if (cancelled) return;
        setHasSavedPassword(false);
      }
      // EMPTY / UNAVAILABLE：什么都不做，也不提示
    })();
    return () => { cancelled = true; };
    // 只在挂载时读一次：secureAvailable 是常量，t 变化不该重新读盘
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secureAvailable]);

  /**
   * 登录成功后按勾选状态落盘。
   *
   * **保存失败不阻断登录**：存不下最多是下次要手输，
   * 但绝不能让用户以为登录失败 —— 所以只给一条琥珀色轻提示 + 一行日志。
   * 静默失败比提示失败更糟：用户勾了「保存密码」，下次发现没预填只会更困惑。
   */
  const persistPassword = async () => {
    // 读 ref 而不是 state：见 savePasswordRef 的注释（在途请求期间用户可能已改主意）
    if (!secureAvailable || !savePasswordRef.current) return;
    const savedBase = baseUrl.trim();
    const saved = await secureSave({ email: email.trim(), password, baseUrl: savedBase });
    if (saved.ok) {
      setHasSavedPassword(true);
      // **必须**同步「这份密文属于哪台服务器」，否则会重新打开一条真实丢数据路径：
      //   首次使用（load() 返回 EMPTY → savedServerUrl 仍为 ''）→ 勾选保存成功 →
      //   hasSavedPassword=true 但 savedServerUrl='' → 用户改到 B 站、在 B 站输错一次 →
      //   addressesKnown=false → sameServerNow 退化 → had=true →
      //   **删掉刚在 A 站存下、仍然有效的凭据**（planStaleCredential 要挡的"路径 1"又回来了，
      //   而且这次连"上次 load 快照"这个前提都不需要）。
      // 注意：**同站** 401 清库是设计意图，这行不是为了阻止同站清除；
      // 它的目的是让"该清的清、不该清的不清"同时成立。
      setSavedServerUrl(savedBase);
      setSecureNotice({ type: 'info', key: 'login.secureSaved' });
    } else {
      setHasSavedPassword(false);
      setSecureNotice({ type: 'warn', key: 'login.secureSaveFailed' });
      console.warn('[secureStore] save failed:', saved.code, saved.message);
    }
  };

  /** 勾选框切换：状态写回配置；关掉即刻清除本机密文，不留「看不见的密码」 */
  const handleSavePasswordToggle = async (next) => {
    const plan = planSaveToggle({ next, available: secureAvailable });
    // 先同步写 ref（早于 setState 与后面的 await clear()）：
    // effect 要等渲染提交才跑，而登录请求的 persistPassword 可能插在中间。
    savePasswordRef.current = Boolean(next);
    setSavePassword(Boolean(next));
    if (plan.persist) setConfig({ savePassword: Boolean(next) });
    setSecureNotice(null);
    if (plan.notice === 'unavailable') {
      // 浏览器 / PWA：勾了也不会存，明说而不是静默失败
      setSecureNotice({ type: 'warn', key: 'login.secureUnavailable' });
      return;
    }
    if (plan.clearStore) {
      const cleared = await secureClear();
      if (cleared.ok) {
        setHasSavedPassword(false);
        setSavedServerUrl('');
      }
      setSecureNotice(cleared.ok
        ? { type: 'info', key: 'login.rememberPasswordOff' }
        : { type: 'warn', key: 'login.clearFailed', params: { detail: cleared.message || cleared.code } });
    }
  };

  /**
   * 「清除」已保存的密码：清除密文 + 清空表单里的账号与密码，退出「已保存」状态。
   *
   * baseUrl **刻意保留** —— 服务器地址不是秘密，清掉会让用户下次先得想起地址才能登录；
   * 需要一并清空的话，把下面 setBaseUrl('') 那行加上即可。
   */
  const handleForgetSaved = async () => {
    const cleared = await secureClear();
    setHasSavedPassword(false);
    setSavedServerUrl('');
    setPassword('');
    setEmail('');
    setShowSecret(false);
    setSecureNotice(cleared.ok
      ? { type: 'info', key: 'login.cleared' }
      : { type: 'warn', key: 'login.clearFailed', params: { detail: cleared.message || cleared.code } });
  };

  /**
   * 401 回退：本机存的密码已被服务端否掉。
   *
   * 分支全部由 planStaleCredential() 决定（纯函数，可被脚本断言）：
   *   - 清空密码框：**无条件**（那串一定不对，留着只会误导）；
   *   - 删除本机密文 / 取消勾选 / 提示「已失效」：**仅当确实存过密码**。
   *
   * 为什么删密文也要受 hadSaved 约束（曾经踩过）：
   *   401 可能只是用户手滑输错一次密码。若此处无条件 secureClear()，
   *   会把**另一台服务器上仍然有效**的已保存密码删掉 —— 用户没要求删除，却丢了凭据。
   *   破坏性动作必须由 plan 统一决定，不能留在调用方"顺手执行"。
   */
  const handleStaleCredential = async () => {
    // 三个输入：是否存过、密文属于哪台、**当前**地址是哪台。
    // 用 baseUrl（state）而不是 cfg.baseUrl：baseUrl 才是刚才 POST 出去的那个地址，
    // cfg 由 effect 异步落盘，用户"改完地址立刻提交"时可能慢一帧。
    const plan = planStaleCredential({
      hadSaved: hasSavedPassword,
      savedServerUrl,
      currentBaseUrl: baseUrl
    });
    if (secureAvailable && plan.clearStore) {
      await secureClear();
      setSavedServerUrl('');
    }
    if (plan.clearSavedBadge) setHasSavedPassword(false);
    if (plan.clearPassword) setPassword('');
    if (plan.uncheck) {
      savePasswordRef.current = false;
      setSavePassword(false);
      setConfig({ savePassword: false });
    }
    if (plan.showExpiredNotice) {
      setSecureNotice({ type: 'warn', key: 'login.secureExpired' });
    }
    try {
      passwordRef.current?.focus();
    } catch {
      // 个别 WebView 在键盘切换期间 focus 会抛，忽略即可
    }
  };

  // ---- ① 测试连接：只探测，不写凭据 ----
  const handleTest = async () => {
    if (!baseUrl.trim()) {
      setStatus({ type: 'error', key: 'login.errBaseUrlRequired' });
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
        setStatus({ type: 'success', key: 'login.testOk', params: { ms } });
      } else if (res.status === 401 || res.status === 403) {
        setStatus({ type: 'success', key: 'login.testUnauthorized', params: { ms } });
      } else {
        setStatus({ type: 'warn', key: 'login.testHttpError', params: { status: res.status } });
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
            key: 'login.testNoAccountApi',
            appendTo: s
          }));
        } else if (r2.ok || r2.status === 401 || r2.status === 400) {
          setStatus((s) => ({
            type: s?.type || 'success',
            key: 'login.testAccountApi',
            appendTo: s
          }));
        }
      } catch { /* 探测失败不影响主结论 */ }
    } catch (err) {
      setStatus({
        type: 'error',
        key: 'login.errConnect', params: { detail: err.message }, fallbacks: { detail: 'common.networkError' }
      });
    } finally {
      setBusy('');
    }
  };

  // ---- ② 账号密码登录并保存 ----
  const handleAccountLogin = async () => {
    if (!email.trim() || !password) {
      setStatus({ type: 'error', key: 'login.errCredentialsRequired' });
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
        setStatus({ type: 'warn', key: 'login.savedNoMe', params: { email: email.trim() } });
      } else {
        setIdentity({
          username: me.user?.username || email.trim(),
          email: me.user?.email || email.trim(),
          tenant: (r.tenantName || '') || (me.tenant?.name || ''),
          token: ''
        });
        setStatus({
          type: 'success',
          key: r.tenantName ? 'login.loginSuccessWithTenant' : 'login.loginSuccess',
          params: r.tenantName
            ? { user: me.user?.username || email.trim(), tenant: r.tenantName }
            : { user: me.user?.username || email.trim() }
        });
      }
      // 凭据真的可用之后才允许保存密码（保存失败不影响本次登录结果）
      await persistPassword();
      // 不立刻跳转：让用户看清"到底登录成功没有"，由他决定何时进入
    } catch (err) {
      setIdentity(null);
      setStatus({ type: 'error', key: 'login.errLoginFailed', params: { detail: err.message }, fallbacks: { detail: 'common.unknownError' } });
      // 401 = 服务端明确说「这组凭据不对」。如果本机存着密码，那它一定已经失效：
      // 清掉密文、取消勾选、清空密码框，并把焦点送回密码框（用户下一步必然是重输）。
      // 注意：判断只看 err.status，**不动 explainLoginError 的文案**（test-auth.mjs 直接断言它）。
      if (err?.status === 401) {
        await handleStaleCredential();
      }
    } finally {
      setBusy('');
    }
  };

  // ---- ③ API Key：测试 + 保存 ----
  const handleApiKeySave = async () => {
    if (!apiKey.trim()) {
      setStatus({ type: 'error', key: 'login.errApiKeyRequired' });
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
      setStatus({ type: 'success', key: 'login.apiKeySaved' });
    } catch (err) {
      // 别把已保存的无效 key 留在配置里，否则下次进来还是坏的
      setConfig({ apiKey: '' });
      setApiKey('');
      setStatus({ type: 'error', key: 'login.errApiKeyInvalid', params: { detail: err.message }, fallbacks: { detail: 'common.loadFailed' } });
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
          <h1 className="text-xl font-bold text-gray-900">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-gray-500">{t('login.subtitle')}</p>
        </div>

        {/* 当前登录状态：明确回答"到底登录了没有" */}
        {identity && (
          <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 p-4">
            <div className="flex items-start gap-2">
              <CheckCircle className="mt-0.5 h-5 w-5 shrink-0 text-green-600" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-green-800">{t('login.loggedIn')}</p>
                <p className="mt-0.5 truncate text-xs text-green-700">{identity.username || t('settings.authLoggedIn')}</p>
                {identity.email && identity.email !== identity.username && (
                  <p className="truncate text-xs text-green-700">{identity.email}</p>
                )}
                {identity.tenant && <p className="text-xs text-green-700">{t('login.tenant')}{identity.tenant}</p>}
                <button
                  type="button"
                  onClick={() => navigate('/', { replace: true })}
                  className="mt-2 w-full rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  {t('login.enterApp')}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 方式切换 */}
        <div className="mb-4 flex gap-2 rounded-2xl bg-white p-1.5 shadow-sm">
          {[
            { key: 'account', labelKey: 'login.modeAccount', icon: UserCircle },
            { key: 'apikey', labelKey: 'login.modeApiKey', icon: Key }
          ].map((opt) => {
            const Icon = opt.icon;
            const active = mode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => { setMode(opt.key); setStatus(null); }}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors',
                  active ? 'bg-brand-500 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-50'
                )}
              >
                <Icon className="h-4 w-4" />
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>

        <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
          <div>
            <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
              <Globe className="h-4 w-4" /> {t('login.baseUrlTitle')}
            </label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={t('login.baseUrlPlaceholder')}
              autoCapitalize="none"
              autoCorrect="off"
              className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
            <p className="mt-1 text-xs text-gray-500">{t('login.baseUrlHint')}</p>
          </div>

          {/* ① 测试连接 —— 独立按钮，不写入凭据 */}
          <button
            type="button"
            onClick={handleTest}
            disabled={busyAny || !baseUrl.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            {busy === 'test' ? t('login.testing') : t('login.test')}
          </button>

          {mode === 'account' ? (
            <>
              <div>
                <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
                  <UserCircle className="h-4 w-4" /> {t('login.fieldEmail')}
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
                  <ShieldCheck className="h-4 w-4" /> {t('login.fieldPassword')}
                </label>
                <div className="relative">
                  <input
                    ref={passwordRef}
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
                    aria-label={showSecret ? t('login.hidePassword') : t('login.showPassword')}
                  >
                    {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {/* 这句必须与新功能一致：旧文案「不会保存在本机」已不成立，统一改为
                    「凭据经系统加密仅存本机」（无桥环境下面板的置灰说明会兜住事实） */}
                <p className="mt-1 text-xs text-gray-500">{t('login.passwordHint')}</p>

                {/* 保存密码：勾选状态写进配置、跨启动保持。
                    无桥环境（浏览器/PWA）下勾选框**照常可点**，但说明常驻一行
                    「不支持安全存储」——比"勾了才发现没生效"更早告知，也绝不弹红条 */}
                <div className={clsx('mt-2 rounded-xl p-3', secureAvailable ? 'bg-surface-soft' : 'bg-gray-50')}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={savePassword}
                      onChange={(e) => handleSavePasswordToggle(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 text-brand-500 focus:ring-brand-500"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 text-sm font-medium text-gray-700">
                        <Lock className="h-3.5 w-3.5" /> {t('login.rememberPassword')}
                      </span>
                      <span
                        className={clsx(
                          'mt-0.5 block text-xs leading-relaxed',
                          secureAvailable ? 'text-gray-500' : 'text-amber-700'
                        )}
                      >
                        {secureAvailable ? t('login.rememberPasswordHint') : t('login.secureUnavailable')}
                      </span>
                    </span>
                  </label>

                  {/* 已保存状态 + 清除入口 */}
                  {secureAvailable && hasSavedPassword && (
                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
                      <span className="flex items-center gap-1 text-[11px] text-gray-500">
                        <CheckCircle className="h-3 w-3 shrink-0 text-emerald-600" /> {t('login.secureSaved')}
                      </span>
                      <button
                        type="button"
                        onClick={handleForgetSaved}
                        className="shrink-0 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-gray-700 shadow-sm hover:bg-gray-100"
                      >
                        {t('login.clear')}
                      </button>
                    </div>
                  )}

                  {secureNotice && (
                    <p
                      className={clsx(
                        'mt-2 flex items-start gap-1 text-[11px] leading-relaxed',
                        secureNotice.type === 'warn' ? 'text-amber-700' : 'text-gray-500'
                      )}
                    >
                      {secureNotice.type === 'warn'
                        ? <AlertCircle className="mt-0.5 h-3 w-3 shrink-0" />
                        : <CheckCircle className="mt-0.5 h-3 w-3 shrink-0" />}
                      <span className="break-words">{noticeText(secureNotice, t)}</span>
                    </p>
                  )}
                </div>

              </div>
            </>
          ) : (
            <div>
              <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
                <Key className="h-4 w-4" /> {t('login.fieldApiKey')}
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
              <p className="mt-1 text-xs text-gray-500">{t('login.apiKeyHint')}</p>
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
              <span className="break-words">{noticeText(status, t)}</span>
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
            {busy === 'login' ? t('login.submitting') : (mode === 'account' ? t('login.submitAccount') : t('login.submitApiKey'))}
          </button>

          {identity && (
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-600"
            >
              <LogIn className="h-4 w-4" /> {t('login.enterApp')}
            </button>
          )}

          {mode === 'account' && (
            <p className="text-center text-xs leading-relaxed text-gray-400">
              {t('login.registerHint')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default Login;
