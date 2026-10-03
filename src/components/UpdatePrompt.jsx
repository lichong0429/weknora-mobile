import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, X, Loader2, AlertCircle, CheckCircle2, Sparkles, RefreshCw } from 'lucide-react';
import { APP_VERSION } from '../utils/appVersion.js';
import { checkForUpdate } from '../utils/updateService.js';
import { releaseNotesPreview, formatBytes, setSkippedVersion } from '../utils/updateChecker.js';
import {
  hasNativeUpdater, downloadUpdate, installUpdate, openReleasePage
} from '../utils/nativeUpdate.js';
import { pushBackHandler } from '../backHandler.js';

// 启动后延迟一点再查，别和首页首屏请求抢带宽
const CHECK_DELAY_MS = 1500;

// 检查失败的原因 → 人话。
// 静默失效比打扰更糟：用户只看到「没弹窗」，无从判断是功能坏了还是没有更新。
function describeCheckFailure(reason) {
  const map = {
    timeout: '检查更新超时：连不上 GitHub，请检查网络或代理设置',
    invalid: '检查更新失败：GitHub 返回的数据里没有可安装的 APK',
    'no-release': '检查更新失败：未取到发布信息（可能触发了匿名接口限流）'
  };
  if (!reason) return '检查更新失败，请检查网络后重试';
  if (map[reason]) return map[reason];
  if (/^HTTP\s/.test(reason)) return `检查更新失败：${reason}（GitHub 接口可能限流，稍后再试）`;
  return '检查更新失败：无法连接 GitHub，请检查网络或代理设置';
}

/**
 * 启动时检查更新。没有任何更新时**不渲染任何东西**，也不显示"已是最新"之类的打扰。
 *
 * 关于「直接更新」的边界（Android 平台约束，无法绕过）：
 *   应用可以自动下载，但不能静默安装 —— 最后一步必须由用户在系统安装界面确认，
 *   首次还需先授权「安装未知应用」。所以这里的做法是：自动下载 → 自动拉起安装界面。
 *   静默安装只对系统应用 / 设备所有者（Device Owner）开放，普通应用拿不到。
 */
export default function UpdatePrompt() {
  const [release, setRelease] = useState(null);
  const [open, setOpen] = useState(false);
  // idle → downloading → installing → done | error
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');
  // 检查失败时的可见提示（原先完全静默 → 用户无法判断功能是否坏了）
  const [checkFail, setCheckFail] = useState('');
  const [rechecking, setRechecking] = useState(false);

  // 记录最近一次检查结果，供设置页展示排障信息
  const lastResult = useRef(null);

  // 组件级函数：启动自动检查与「重试」共用。
  // （原先把它定义在 useEffect 内部，重试按钮拿不到引用 —— 闭包陷阱）
  const runCheck = useCallback(async (force = false) => {
    if (force) setRechecking(true);
    const result = await checkForUpdate({ force });
    lastResult.current = result;
    if (force) setRechecking(false);
    if (result.status === 'update' && !result.skipped) {
      setCheckFail('');
      setRelease(result.release);
      setPhase('idle');
      setError('');
      setOpen(true);
    } else if (result.status === 'error' || result.status === 'unknown') {
      // 只在「确实是失败」时提示；latest（含缓存命中）不提示，那是正常状态
      setCheckFail(describeCheckFailure(result.reason));
    }
    return result;
  }, []);

  // 挂到 window 上：设置页的「立即检查」按钮要能复用同一个函数。
  // 必须放在 runCheck 定义之后 —— const 不会提升，顺序反了会撞 TDZ。
  useEffect(() => {
    window.__weknoraCheckUpdate = (force = true) => runCheck(force);
    return () => { delete window.__weknoraCheckUpdate; };
  }, [runCheck]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      await runCheck(false);
    }, CHECK_DELAY_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [runCheck]);

  // Android 返回键关弹窗
  useEffect(() => {
    if (!open) return undefined;
    return pushBackHandler(() => {
      if (phase === 'downloading' || phase === 'installing') return true; // 进行中不关，避免状态错乱
      setOpen(false);
      return true;
    });
  }, [open, phase]);

  // 检查失败的轻提示：一行文字 + 重试，不做弹窗（不打扰是原则，
  // 但「静默失效」比「打扰」更糟——用户无从判断功能状态）
  if (checkFail && !open) {
    return (
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-4 pt-14">
        <div className="pointer-events-auto flex max-w-sm items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 shadow-lg ring-1 ring-amber-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p>{checkFail}</p>
            <button
              type="button"
              onClick={() => runCheck(true)}
              disabled={rechecking}
              className="mt-1 inline-flex items-center gap-1 font-medium text-amber-900 underline underline-offset-2 disabled:opacity-60"
            >
              {rechecking ? '重试中…' : '重试'}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCheckFail('')}
            className="shrink-0 rounded p-0.5 text-amber-400 hover:text-amber-700"
            aria-label="关闭"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // 注意：本块必须放在所有 Hook 之后。React 要求每次渲染的 Hook 数量与顺序一致，
  // 提前 return 会让后续 useEffect 时有时无 → 整棵树被卸载（页面一片空白）。

  if (!open || !release) return null;

  const busy = phase === 'downloading' || phase === 'installing';
  const native = hasNativeUpdater();

  const startUpdate = async () => {
    setError('');
    if (!native) {
      // 浏览器 / PWA：没有安装能力，交给 Release 页面
      openReleasePage(release.releaseUrl);
      setOpen(false);
      return;
    }
    try {
      setPhase('downloading');
      const { fileName } = await downloadUpdate(
        release.apkUrl,
        release.apkName || 'weknora-mobile.apk'
      );
      setPhase('installing');
      await installUpdate(fileName);
      setPhase('done');
    } catch (err) {
      setPhase('error');
      setError(err.message || '更新失败，请稍后重试');
    }
  };

  const skipVersion = () => {
    setSkippedVersion(release.version);
    setOpen(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-start gap-3 border-b border-line p-4">
          <div className="mt-0.5 rounded-xl bg-brand-50 p-2">
            <Sparkles className="h-5 w-5 text-brand-600" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-gray-900">发现新版本 {release.tag}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              当前 {APP_VERSION}
              {formatBytes(release.apkSize) ? ` · 更新包 ${formatBytes(release.apkSize)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={() => !busy && setOpen(false)}
            disabled={busy}
            className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100 disabled:opacity-40"
            aria-label="关闭"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {release.notes ? (
          <div className="max-h-56 overflow-y-auto px-4 py-3">
            <p className="mb-1 text-xs font-medium text-gray-500">更新内容</p>
            <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">
              {releaseNotesPreview(release.notes)}
            </p>
            <button
              type="button"
              onClick={() => openReleasePage(release.releaseUrl)}
              className="mt-2 text-xs text-brand-600 underline"
            >
              查看完整说明
            </button>
          </div>
        ) : null}

        {phase === 'done' && (
          <div className="mx-4 mb-1 flex items-start gap-2 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>已下载完成，请在系统弹出的安装界面点「安装」完成更新。</span>
          </div>
        )}
        {phase === 'error' && (
          <div className="mx-4 mb-1 flex items-start gap-2 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          {phase === 'done' ? (
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="flex-1 rounded-xl bg-surface-subtle py-2.5 text-sm font-medium text-gray-700"
            >
              关闭
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => !busy && setOpen(false)}
                disabled={busy}
                className="flex-1 rounded-xl bg-surface-subtle py-2.5 text-sm font-medium text-gray-700 disabled:opacity-50"
              >
                稍后
              </button>
              <button
                type="button"
                onClick={startUpdate}
                disabled={busy}
                className="flex flex-[1.4] items-center justify-center gap-2 rounded-xl bg-brand-600 py-2.5 text-sm font-medium text-white disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {phase === 'downloading' ? '下载中…' : phase === 'installing' ? '准备安装…' : native ? '下载并更新' : '去下载'}
              </button>
            </>
          )}
        </div>

        {!busy && phase !== 'done' && (
          <div className="border-t border-line px-4 py-2 text-center">
            <button
              type="button"
              onClick={skipVersion}
              className="text-[11px] text-gray-400 underline"
            >
              跳过此版本（不再提示 {release.tag}）
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
