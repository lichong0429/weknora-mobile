import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Home, Database, Search, MessageSquare, Settings, ChevronLeft } from 'lucide-react';
import { clsx } from 'clsx';
import { useEffect, useRef } from 'react';
import { pushBackHandler } from '../backHandler.js';
import { useVisibleViewportHeight } from '../hooks/useVisibleViewportHeight.js';
import ErrorBoundary from './ErrorBoundary.jsx';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/kbs', label: '知识库', icon: Database },
  { to: '/search', label: '搜索', icon: Search },
  { to: '/sessions', label: '会话', icon: MessageSquare },
  { to: '/settings', label: '设置', icon: Settings }
];

function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isRoot = location.pathname === '/';

  // 仅在 5 个主 Tab 页面显示底部导航；子页面（会话/知识详情等）隐藏，
  // 避免与页面自身的输入区/操作区叠加遮挡。
  const showTabBar = ['/', '/kbs', '/search', '/sessions', '/settings'].includes(location.pathname);
  // 聊天页需要「确定的可用高度」：消息区自己滚动、输入框贴底（见下方 main 里的注释）
  const isChatRoute = location.pathname.startsWith('/session/');

  // 软键盘弹出时把最外层容器高度锁到「可见高度」，否则输入框会被键盘盖住
  const containerRef = useRef(null);
  useVisibleViewportHeight(containerRef);

  // 手势/系统返回：非首页回上一页（React Router 内部历史），首页返回 false 交给原生退出应用
  useEffect(() => {
    const dispose = pushBackHandler(() => {
      if (location.pathname === '/') return false; // 已在首页，退出应用
      navigate(-1);
      return true;
    });
    return dispose;
  }, [location.pathname, navigate]);

  return (
    // h-screen 是旧内核的兜底（100vh）；支持时用 100dvh 跟随动态工具栏。
    // 软键盘由 useVisibleViewportHeight 内联覆盖（dvh 是否随键盘变化取决于内核，不可依赖）。
    <div
      ref={containerRef}
      className="flex h-screen w-full flex-col bg-surface-soft supports-[height:100dvh]:h-[100dvh]"
    >
      <header className="safe-top sticky top-0 z-20 flex items-center gap-3 bg-white/90 backdrop-blur px-4 py-3 border-b border-line">
        {!isRoot && (
          <button
            onClick={() => navigate(-1)}
            className="rounded-xl p-1.5 hover:bg-surface-subtle active:scale-95 transition-transform"
            aria-label="返回"
          >
            <ChevronLeft className="h-5 w-5 text-ink" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-ink">
          {isRoot ? (
            <span className="flex items-center gap-2">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-[10px] bg-gradient-to-br from-brand-500 to-brand-400 text-white text-sm font-bold">W</span>
              WeKnora
            </span>
          ) : 'WeKnora Mobile'}
        </h1>
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar">
        {/* pb-40（160px）是给悬浮底部导航留的占位。它原先对所有路由生效，而导航只在
            5 个主 Tab 页显示 —— 聊天页没有导航却照样多出 160px，正好是用户看到的
            「输入框与键盘之间空了一大块」。故改为只在显示导航时加。
            聊天页另给 h-full + overflow-hidden：让 Chat 的 flex-1 有确定高度，
            消息区自己滚动、输入区钉在底部（父层是 min-h-full 时高度不定，输入框会随
            长内容被推走）。 */}
        <div
          className={clsx(
            'mx-auto flex w-full max-w-md flex-col',
            isChatRoute ? 'h-full overflow-hidden' : 'min-h-full',
            // 主 Tab 页给底部悬浮导航留位；无导航的子页面原先靠这 160px 顺带避开了
            // 手势条，去掉后只补一个安全区内边距，避免末尾按钮贴到手势条上。
            showTabBar ? 'pb-40' : !isChatRoute && 'pb-safe'
          )}
        >
          {/* 页面级错误边界：单个页面渲染异常不再拖垮整棵树（此前会导致全白屏且无法返回）。
              key 用路径，切到其他页面时自动重新挂载并清空错误状态。 */}
          <ErrorBoundary key={location.pathname} onBack={() => navigate(-1)}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      {/* Pill 悬浮底部导航 */}
      {showTabBar && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 pb-safe">
          <div className="mx-auto max-w-md px-5 pb-5 pt-2">
            <ul className="flex h-[62px] items-center rounded-[36px] border border-line bg-white p-1 shadow-pill">
              {navItems.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to} className="flex-1">
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        clsx(
                          'flex h-full flex-col items-center justify-center gap-[3px] rounded-[27px] py-1 text-[10px] font-medium tracking-wide transition-colors',
                          isActive
                            ? 'bg-gradient-to-br from-brand-500 to-brand-400 text-white'
                            : 'text-ink-muted hover:text-ink'
                        )
                      }
                    >
                      <Icon className="h-[18px] w-[18px]" strokeWidth={isRoot && item.to === '/' ? 2.2 : 1.8} />
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>
      )}
    </div>
  );
}

export default Layout;
