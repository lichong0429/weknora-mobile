import { useEffect } from 'react';

/**
 * 让容器高度跟随「用户真正能看到的区域」，主要用于软键盘弹出时不被遮挡。
 *
 * 为什么不用 100vh / 100dvh 处理键盘：
 *   软键盘弹出时布局视口（layout viewport）会不会缩小，取决于 WebView 内核与宿主
 *   的组合（Chrome 系默认 interactive-widget=resizes-visual，此时 vh / dvh 都不变）。
 *   也就是说 100vh 在部分内核上仍是「整屏高」，输入框会被顶到键盘下方看不见。
 *   而 visualViewport.height 是用户实际可视区域的真实高度，与内核策略无关。
 *
 * 与 CSS 的分工（两者不会互相打架）：
 *   - 没有键盘时清空内联高度，交给 CSS 的 h-screen / 100dvh 生效，
 *     这样地址栏收起/展开等场景仍由 CSS 处理，不重复计算。
 *   - 只有"可视高度明显小于布局视口"（即键盘确实占了一块）时才接管高度。
 *
 * 实现要点：
 *   - 直接写 DOM style，不用 state：键盘动画期间 resize 会连发几十次，
 *     走 setState 会让整个 Layout（含 Outlet 子树）反复重渲染。
 *   - resize / scroll 事件用 requestAnimationFrame 合并成每帧最多一次计算。
 *   - 卸载时移除监听、取消挂起的 rAF，并清掉内联高度，避免路由切换或热更新后残留。
 *
 * @param {{ current: (HTMLElement|null) }} ref 需要跟随可视高度的容器（通常是最外层 div）
 */
export function useVisibleViewportHeight(ref) {
  useEffect(() => {
    const el = ref?.current;
    // 老内核没有 visualViewport：保持 CSS 的 h-screen 行为（此时 adjustResize 一般
    // 会直接缩小 WebView，100vh 本身就会跟着变），不额外干预。
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!el || !vv) return undefined;

    let rafId = 0;

    const apply = () => {
      rafId = 0;
      const visibleHeight = Math.round(vv.height);
      // 双指缩放同样会让 visualViewport.height 变小，但那不是键盘：
      // scale ≠ 1 时不接管高度，否则用户一缩放容器就被压扁。
      const zoomed = Math.abs((vv.scale || 1) - 1) > 0.01;
      // 1px 容差：避免亚像素抖动导致样式在「内联高度」与「CSS 高度」之间来回切换
      const keyboardUp = !zoomed && visibleHeight + 1 < window.innerHeight;
      const nextHeight = keyboardUp ? `${visibleHeight}px` : '';
      if (el.style.height !== nextHeight) el.style.height = nextHeight;
    };

    const schedule = () => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(apply);
    };

    apply();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);

    return () => {
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      if (rafId) window.cancelAnimationFrame(rafId);
      el.style.height = '';
    };
  }, [ref]);
}

export default useVisibleViewportHeight;
