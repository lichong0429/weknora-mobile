import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { Home, Database, Search, MessageSquare, Settings, ChevronLeft } from 'lucide-react';
import { clsx } from 'clsx';

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

  return (
    <div className="flex flex-col h-screen w-full bg-surface-soft">
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
        <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-col pb-32">
          <Outlet />
        </div>
      </main>

      {/* Pill 悬浮底部导航 */}
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
    </div>
  );
}

export default Layout;
