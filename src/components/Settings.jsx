import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { useConfig } from '../contexts/ConfigContext.jsx';
import { useI18n } from '../i18n/I18nContext.jsx';
import { KB, Model } from '../api/endpoints.js';
import { logout } from '../api/auth.js';
import { resolveAuthMode, AUTH_MODE_ACCOUNT } from '../utils/auth.js';
import { isAvailable as secureIsAvailable, clear as secureClear } from '../utils/secureStore.js';
import { APP_VERSION } from '../utils/appVersion.js';
import { noticeText } from '../utils/noticeText.js';
import { describeCheckFailure } from '../utils/updateMessages.js';
import { AlertCircle, CheckCircle, Key, Globe, TestTube, Bug, Cpu, Database, Globe as WebSearchIcon, Activity, ChevronRight, Sun, Moon, Monitor, UserCircle, LogOut, RefreshCw, Languages, ShieldCheck, Lock } from 'lucide-react';

// 语言选项的标签是**语言自己的名字**（endonym），任何界面语言下都保持原样：
// 用户在被误设成看不懂的语言时，必须还能认出自己的母语那一项。
// 因此这两条**故意不进字典**。
const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' }
];

function Settings() {
  const navigate = useNavigate();
  const { config, setConfig, theme, setTheme } = useConfig();
  const { t, lang, setLang } = useI18n();
  const [baseUrl, setBaseUrl] = useState(config.baseUrl || 'http://localhost:8080');
  const [apiKey, setApiKey] = useState(config.apiKey || '');
  const [testStatus, setTestStatus] = useState(null);
  const [testing, setTesting] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateMsg, setUpdateMsg] = useState(null);
  // 原生安全存储是否可用（同步判断即可；这里**不调 load()** —— 只是显示一个入口，
  // 没必要为了探测状态去解密一次密文）
  const [secureAvailable] = useState(() => secureIsAvailable());
  const [forgetMsg, setForgetMsg] = useState(null);

  // 忘记已保存的密码：先确认（不可撤销），再清掉密文并给出结果回显
  const handleForgetSavedPassword = async () => {
    if (!window.confirm(t('settings.forgetSavedPasswordConfirm'))) return;
    const res = await secureClear();
    setForgetMsg(res.ok
      ? { type: 'success', key: 'settings.forgetSavedPasswordDone' }
      : { type: 'error', key: 'settings.forgetSavedPasswordFailed', params: { detail: res.message || res.code } });
  };

  // 复用 UpdatePrompt 挂在 window 上的检查函数（force=true 跳过缓存）。
  // 启动时的自动检查是静默的，这里必须给出确定结果 —— 否则用户无法分辨
  // 「没有新版本」和「检查功能坏了」。
  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateMsg(null);
    try {
      const fn = window.__weknoraCheckUpdate;
      if (typeof fn !== 'function') {
        setUpdateMsg({ type: 'error', key: 'settings.updateNotReady' });
        return;
      }
      const r = await fn(true);
      if (r?.status === 'update') {
        setUpdateMsg({ type: 'success', key: 'settings.updateFound', params: { tag: r.release?.tag || '' } });
      } else if (r?.status === 'latest') {
        // 自动检查是静默的，所以「已是最新」只在这里给一句确认 —— 用户按了按钮就该有回执
        setUpdateMsg({ type: 'success', key: 'settings.updateLatest', params: { version: APP_VERSION } });
      } else {
        // 失败原因 → 人话（{key, params}，渲染期翻译，切语言会跟着变）；
        // 不再把 'no-release' / 'HTTP 403' 这类原因码原样丢给用户看。
        setUpdateMsg({ type: 'warn', ...describeCheckFailure(r?.reason) });
      }
    } catch (err) {
      setUpdateMsg({ type: 'error', raw: err.message, fallbackKey: 'settings.updateFailedShort' });
    } finally {
      setCheckingUpdate(false);
    }
  };

  const isAccount = resolveAuthMode(config) === AUTH_MODE_ACCOUNT;

  const handleSave = () => {
    setConfig({ baseUrl, apiKey });
    setTestStatus({ type: 'success', key: 'settings.saved' });
  };

  const handleTest = async () => {
    setTesting(true);
    setTestStatus(null);
    try {
      setConfig({ baseUrl, apiKey });
      const [kbRes, modelRes] = await Promise.all([KB.list(), Model.list()]);
      const kbCount = Array.isArray(kbRes?.data) ? kbRes.data.length : 0;
      const modelCount = Array.isArray(modelRes?.data) ? modelRes.data.length : 0;
      setTestStatus({ type: 'success', key: 'settings.testSuccess', params: { kbs: kbCount, models: modelCount } });
    } catch (err) {
      setTestStatus({ type: 'error', raw: err.message, fallbackKey: 'settings.testFailed' });
    } finally {
      setTesting(false);
    }
  };

  useEffect(() => {
    setBaseUrl(config.baseUrl || 'http://localhost:8080');
    setApiKey(config.apiKey || '');
  }, [config.baseUrl, config.apiKey]);

  // 主题选项：value 是持久化枚举（system/light/dark），文案走字典
  const themeOptions = [
    { value: 'system', label: t('settings.themeSystem'), desc: t('settings.themeSystemDesc'), icon: Monitor },
    { value: 'light', label: t('settings.themeLight'), desc: t('settings.themeLightDesc'), icon: Sun },
    { value: 'dark', label: t('settings.themeDark'), desc: t('settings.themeDarkDesc'), icon: Moon }
  ];

  return (
    <div className="p-4">
      <h2 className="mb-4 text-xl font-bold text-gray-900">{t('settings.title')}</h2>

      {/* 当前登录身份：一眼看出用的是哪种方式、是谁 */}
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
          <UserCircle className="h-5 w-5 text-brand-500" /> {t('settings.authTitle')}
        </h3>
        {isAccount ? (
          <div className="space-y-3">
            <div className="rounded-xl bg-brand-50 p-3">
              <p className="text-sm font-medium text-brand-800">
                {/* 用户名/邮箱/空间名都是用户数据，不进字典 */}
                {config.authUser?.username || config.authEmail || t('settings.authLoggedIn')}
              </p>
              {config.authUser?.email && (
                <p className="mt-0.5 text-xs text-brand-600">{config.authUser.email}</p>
              )}
              {config.authTenantName && (
                <p className="mt-0.5 text-xs text-brand-600">{t('settings.authTenant')}{config.authTenantName}</p>
              )}
              <p className="mt-1.5 text-xs text-brand-500">{t('settings.authAccountHint')}</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => navigate('/login')}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                <RefreshCw className="h-4 w-4" /> {t('settings.authSwitchAccount')}
              </button>
              <button
                onClick={() => { logout(); navigate('/login', { replace: true }); }}
                className="flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-white px-3 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50"
              >
                <LogOut className="h-4 w-4" /> {t('settings.authLogout')}
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-gray-50 p-3">
            <p className="text-sm font-medium text-gray-800">{t('settings.authApiKeyMode')}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {apiKey ? t('settings.authConfigured') : t('settings.authNotConfigured')}
              {/* Key 掩码是凭据片段，不是可翻译文案：用半角括号直接拼在句末 */}
              {config.apiKey ? ` (${config.apiKey.slice(0, 4)}****${config.apiKey.slice(-4)})` : ''}
            </p>
            <button
              onClick={() => navigate('/login')}
              className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              {t('settings.authSwitchToApiKey')}
            </button>
          </div>
        )}
      </div>

      {/* 账号与安全：本机保存的密码的清除入口。
          只显示而不是探测「有没有存过」（不调 load()，避免无谓解密）。 */}
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
          <ShieldCheck className="h-5 w-5 text-brand-500" /> {t('settings.securityTitle')}
        </h3>
        {secureAvailable ? (
          <>
            <p className="mb-3 flex items-start gap-1 text-xs text-gray-500">
              <Lock className="mt-0.5 h-3 w-3 shrink-0" /> {t('settings.securityHint')}
            </p>
            <button
              type="button"
              onClick={handleForgetSavedPassword}
              className="flex w-full items-center gap-3 rounded-xl border border-gray-200 p-3 text-left transition-colors hover:bg-gray-50 active:bg-gray-100"
            >
              <div className="rounded-xl bg-red-50 p-2 text-red-600">
                <Lock className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900">{t('settings.forgetSavedPassword')}</p>
                <p className="truncate text-xs text-gray-500">{t('settings.forgetSavedPasswordDesc')}</p>
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
            </button>
            {forgetMsg && (
              <div
                className={clsx(
                  'mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
                  forgetMsg.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                )}
              >
                {forgetMsg.type === 'success'
                  ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
                <span className="break-words">{noticeText(forgetMsg, t)}</span>
              </div>
            )}
          </>
        ) : (
          <p className="flex items-start gap-1 text-xs leading-relaxed text-gray-500">
            <Lock className="mt-0.5 h-3 w-3 shrink-0" /> {t('settings.secureStorageUnavailable')}
          </p>
        )}
      </div>

      <div className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
            <Globe className="h-4 w-4" /> {t('settings.baseUrlTitle')}
          </label>
          <input
            type="url"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="http://localhost:8080"
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">{t('settings.baseUrlHint')}</p>
        </div>

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium text-gray-700">
            <Key className="h-4 w-4" /> {t('settings.apiKeyTitle')}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            {t('settings.apiKeyHint')}
            {isAccount && t('settings.apiKeyHintAccount')}
          </p>
        </div>

        {testStatus && (
          <div
            className={clsx(
              'flex items-center gap-2 rounded-xl px-3 py-2 text-sm',
              testStatus.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
            )}
          >
            {testStatus.type === 'success' ? <CheckCircle className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
            {noticeText(testStatus, t)}
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
          >
            {t('settings.save')}
          </button>
          <button
            onClick={handleTest}
            disabled={testing}
            className="flex items-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <TestTube className="h-4 w-4" />
            {testing ? t('settings.testing') : t('settings.test')}
          </button>
        </div>
      </div>

      <div className="mt-6 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-900">{t('settings.adminTitle')}</h3>
        <div className="space-y-2">
          <SettingRow icon={Cpu} label={t('settings.adminModels')} desc={t('settings.adminModelsDesc')} to="/models" />
          <SettingRow icon={Database} label={t('settings.adminVectorStores')} desc={t('settings.adminVectorStoresDesc')} to="/vector-stores" />
          <SettingRow icon={WebSearchIcon} label={t('settings.adminWebSearch')} desc={t('settings.adminWebSearchDesc')} to="/web-searches" />
          <SettingRow icon={Activity} label={t('settings.adminSystem')} desc={t('settings.adminSystemDesc')} to="/system" />
        </div>
      </div>

      <button
        onClick={() => navigate('/diagnostics')}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-white p-4 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
      >
        <Bug className="h-4 w-4" /> {t('settings.diagnostics')}
      </button>

      {/* 手动检查更新：启动时的自动检查是静默的（失败只在顶部提示条里），
          这里给一个确定性的入口 —— 「到底能不能检查到更新」不该要靠猜 */}
      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-2 font-semibold text-gray-900">{t('settings.updateTitle')}</h3>
        <p className="mb-3 text-xs text-gray-500">
          {t('settings.updateCurrent', { version: APP_VERSION })}
        </p>
        <button
          onClick={handleCheckUpdate}
          disabled={checkingUpdate}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          {checkingUpdate ? <RefreshCw className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {checkingUpdate ? t('settings.updateChecking') : t('settings.updateCheck')}
        </button>
        {updateMsg && (
          <div
            className={clsx(
              'mt-3 flex items-start gap-2 rounded-xl px-3 py-2 text-sm',
              updateMsg.type === 'success' ? 'bg-green-50 text-green-700'
                : updateMsg.type === 'warn' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'
            )}
          >
            {updateMsg.type === 'success' ? <CheckCircle className="mt-0.5 h-4 w-4 shrink-0" />
              : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />}
            <span className="break-words">{noticeText(updateMsg, t)}</span>
          </div>
        )}
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-3 font-semibold text-gray-900">{t('settings.appearanceTitle')}</h3>
        <div className="space-y-2">
          {themeOptions.map((opt) => {
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

        {/* 界面语言：与主题同属「外观」，切换后立即生效并写入 localStorage；
            不做重挂载（不写 key={lang}），因此聊天输入草稿/登录表单不会被清空 */}
        <div className="mt-4 border-t border-gray-100 pt-3">
          <p className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
            <Languages className="h-4 w-4" /> {t('settings.languageTitle')}
          </p>
          <div className="flex gap-2">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = lang === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setLang(opt.value)}
                  aria-pressed={active}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors',
                    active ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                  )}
                >
                  {/* 语言名是 endonym，两种界面语言下都原样显示 */}
                  {opt.label}
                  {active && <CheckCircle className="h-4 w-4 shrink-0 text-brand-500" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl bg-white p-4 shadow-sm">
        <h3 className="mb-2 font-semibold text-gray-900">{t('settings.aboutTitle')}</h3>
        <p className="text-sm text-gray-600 leading-relaxed">
          {t('settings.aboutBody')}
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
