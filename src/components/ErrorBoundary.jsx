import { Component } from 'react';
import { AlertTriangle, RotateCcw, ChevronLeft } from 'lucide-react';

/**
 * 页面级错误边界。
 *
 * 背景：本项目此前没有错误边界，任何一处渲染异常都会让 React 卸载**整棵**组件树，
 * 表现是「页面一片空白，连底部导航和返回按钮都不见了」——用户既看不懂也无法自救。
 *
 * 用法：包在 <Outlet /> 外层，并用路由路径作为 key，
 * 这样切换到其他页面时会自动重新挂载、清空错误状态。
 *
 * 注意：错误边界只能捕获子组件树的渲染期异常，捕获不了事件回调与异步错误本身，
 * 但足以把「整树白屏」降级为「单页可恢复的提示」。
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // 保留到控制台，便于在 WebView 远程调试时定位
    console.error('[ErrorBoundary] 页面渲染异常:', error, info?.componentStack);
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    const { children, onBack } = this.props;

    if (!error) return children;

    return (
      <div className="p-4">
        <div className="rounded-[20px] bg-white p-4 shadow-card">
          <div className="mb-2 flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-5 w-5" />
            <span className="font-semibold">这个页面出错了</span>
          </div>

          <p className="mb-3 text-xs leading-relaxed text-ink-muted">
            页面渲染时发生异常。已限制在单个页面内，其他页面不受影响。
            你可以重试，或返回上一页。
          </p>

          <div className="mb-3 rounded-lg bg-surface-soft p-2.5 text-[11px] leading-relaxed break-all text-ink-muted">
            {error?.message || String(error)}
          </div>

          <div className="flex gap-2">
            <button
              onClick={this.handleRetry}
              className="flex flex-1 items-center justify-center gap-1 rounded-[14px] bg-gradient-to-br from-brand-600 to-brand-400 py-2.5 text-sm font-medium text-white shadow-brand-lg active:scale-95"
            >
              <RotateCcw className="h-4 w-4" /> 重试
            </button>
            {onBack && (
              <button
                onClick={onBack}
                className="flex flex-1 items-center justify-center gap-1 rounded-[14px] bg-surface-subtle py-2.5 text-sm font-medium text-ink active:scale-95"
              >
                <ChevronLeft className="h-4 w-4" /> 返回
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
