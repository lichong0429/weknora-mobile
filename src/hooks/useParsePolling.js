import { useEffect, useRef } from 'react';
import { allStalled, hasInFlight, inFlightSignature } from '../utils/parseStatus.js';

const DEFAULT_INTERVAL_MS = 4000;
const STALLED_INTERVAL_MS = 15000;

// 解析进度自动轮询。
//
// 设计要点：
// 1) 只在存在 pending/processing/finalizing 文档时才起定时器，全部落到终态立即停，
//    避免空转请求（后端列表接口较重）。
// 2) 定时器依赖「在飞行文档签名」而非整个列表，列表内容刷新不会重置倒计时。
// 3) 全部文档停滞超过阈值（默认 20min）后降频到 15s，减少对后端的无效压力。
// 4) 页面不可见（切后台 / 锁屏）时暂停，回到前台立刻补一次刷新 —— 手机场景下
//    这是省电与被系统回收连接的关键。
export function useParsePolling({
  items,
  onPoll,
  enabled = true,
  intervalMs = DEFAULT_INTERVAL_MS,
  stalledIntervalMs = STALLED_INTERVAL_MS
}) {
  const onPollRef = useRef(onPoll);
  onPollRef.current = onPoll;

  const signature = inFlightSignature(items);
  const active = enabled && hasInFlight(items);
  const stalled = active && allStalled(items);

  useEffect(() => {
    if (!active) return undefined;

    let timer = null;
    let cancelled = false;
    const period = stalled ? stalledIntervalMs : intervalMs;

    const tick = async () => {
      if (cancelled) return;
      // 页面不可见时跳过本轮，但仍保留定时器（回前台会立即补一次）
      if (typeof document !== 'undefined' && document.hidden) {
        schedule();
        return;
      }
      try {
        await onPollRef.current?.();
      } catch {
        // 轮询失败静默处理：下一轮重试，不打扰用户（列表页已有错误提示位）
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(tick, period);
    };

    const onVisible = () => {
      if (cancelled) return;
      if (typeof document !== 'undefined' && !document.hidden) {
        if (timer) clearTimeout(timer);
        tick();
      }
    };

    schedule();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // signature 变化意味着「在飞行的文档集合或其阶段」变了，需要重建定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stalled, signature, intervalMs, stalledIntervalMs]);

  return { polling: active, stalled };
}

export default useParsePolling;
