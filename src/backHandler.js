// 全局返回键处理器栈（LIFO）。
// Android 原生层 onBackPressed 会调用 window.__wbOnBack()，这里从栈顶依次执行，
// 返回 true 表示已消费（停止），返回 false 继续往下；全部 false 则原生退出应用。
// 这样多个组件可叠加注册（如全屏预览覆盖在页面返回之上），互不干扰。

const handlers = [];

export function pushBackHandler(fn) {
  handlers.push(fn);
  return () => {
    const i = handlers.indexOf(fn);
    if (i >= 0) handlers.splice(i, 1);
  };
}

// 应用启动时调用一次，挂载全局入口
export function initGlobalBackHandler() {
  window.__wbOnBack = () => {
    for (let i = handlers.length - 1; i >= 0; i--) {
      try {
        if (handlers[i]() === true) return true;
      } catch {
        // 忽略单个 handler 异常
      }
    }
    return false;
  };
}
