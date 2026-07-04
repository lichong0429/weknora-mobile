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
    <div className="flex flex-col h-screen w-full bg-gray-50">
      <header className="safe-top sticky top-0 z-20 flex items-center gap-3 bg-white px-4 py-3 shadow-sm">
        {!isRoot && (
          <button
            onClick={() => navigate(-1)}
            className="rounded-full p-1 hover:bg-gray-100"
            aria-label="返回"
          >
            <ChevronLeft className="h-6 w-6 text-gray-700" />
          </button>
        )}
        <h1 className="text-lg font-semibold text-gray-900">WeKnora Mobile</h1>
      </header>

      <main className="flex-1 overflow-y-auto no-scrollbar safe-bottom">
        <div className="mx-auto flex h-full min-h-0 w-full max-w-md flex-col pb-20">
          <Outlet />
        </div>
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-30 border-t bg-white pb-safe">
        <ul className="flex h-16 items-center justify-around safe-bottom">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <li key={item.to} className="flex-1">
                <NavLink
                  to={item.to}
                  className={({ isActive }) =>
                    clsx(
                      'flex flex-col items-center justify-center py-2 text-xs font-medium transition-colors',
                      isActive ? 'text-blue-600' : 'text-gray-500 hover:text-gray-700'
                    )
                  }
                >
                  <Icon className="h-5 w-5 mb-1" />
                  {item.label}
                </NavLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

export default Layout;
