import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useRef } from 'react';
import { ConfigProvider, useConfig } from './contexts/ConfigContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import Settings from './components/Settings.jsx';
import KBList from './components/KBList.jsx';
import KBDetail from './components/KBDetail.jsx';
import KnowledgeDetail from './components/KnowledgeDetail.jsx';
import AgentList from './components/AgentList.jsx';
import AgentDetail from './components/AgentDetail.jsx';
import SessionList from './components/SessionList.jsx';
import Chat from './components/Chat.jsx';
import Search from './components/Search.jsx';
import Diagnostics from './components/Diagnostics.jsx';
import ModelList from './components/ModelList.jsx';
import ModelDetail from './components/ModelDetail.jsx';
import VectorStoreList from './components/VectorStoreList.jsx';
import VectorStoreDetail from './components/VectorStoreDetail.jsx';
import WebSearchProviderList from './components/WebSearchProviderList.jsx';
import WebSearchProviderDetail from './components/WebSearchProviderDetail.jsx';
import SystemInfo from './components/SystemInfo.jsx';
import UpdatePrompt from './components/UpdatePrompt.jsx';
import { hasCredentials, resolveAuthMode, AUTH_MODE_ACCOUNT } from './utils/auth.js';
import { onUnauthorized } from './api/client.js';

// 登录守卫：没有可用凭据时不渲染主界面。
//
// 放在路由层而不是各页面里，是因为缺凭据时任何接口都会失败 ——
// 让用户先看到一屏"知识库加载失败"再去找设置，是很差的体验。
function RequireAuth({ children }) {
  const { config } = useConfig();
  if (!hasCredentials(config)) return <Login />;
  return children;
}

// 登录态失效（refresh 也失败）时清掉 token，让守卫接管并回到登录页。
// 只在账号模式下生效：API Key 模式下 401 通常意味着 key 无效，
// 那应该由用户自己去设置页改，不该被自动踢出。
function AuthWatcher() {
  const { config, setConfig } = useConfig();
  // 回调会频繁触发，用 ref 固定最新值，避免每次渲染都重新注册
  const latest = useRef({ config, setConfig });
  latest.current = { config, setConfig };

  useEffect(() => {
    onUnauthorized(() => {
      const c = latest.current.config;
      if (resolveAuthMode(c) !== AUTH_MODE_ACCOUNT) return;
      latest.current.setConfig({ authToken: '', authRefreshToken: '' });
    });
  }, []);

  return null;
}

function App() {
  return (
    <ConfigProvider>
      {/* 启动时检查更新：有新版才弹窗，没有则完全不渲染、不打扰 */}
      <UpdatePrompt />
      <AuthWatcher />
      <RequireAuth>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="settings" element={<Settings />} />
            <Route path="diagnostics" element={<Diagnostics />} />
            <Route path="kbs" element={<KBList />} />
            <Route path="kb/:id" element={<KBDetail />} />
            <Route path="knowledge/:id" element={<KnowledgeDetail />} />
            <Route path="agents" element={<AgentList />} />
            <Route path="agent/:id" element={<AgentDetail />} />
            <Route path="sessions" element={<SessionList />} />
            <Route path="session/:id" element={<Chat />} />
            <Route path="search" element={<Search />} />
            <Route path="models" element={<ModelList />} />
            <Route path="model/:id" element={<ModelDetail />} />
            <Route path="vector-stores" element={<VectorStoreList />} />
            <Route path="vector-store/:id" element={<VectorStoreDetail />} />
            <Route path="web-searches" element={<WebSearchProviderList />} />
            <Route path="web-search/:id" element={<WebSearchProviderDetail />} />
            <Route path="system" element={<SystemInfo />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </RequireAuth>
    </ConfigProvider>
  );
}

export default App;
