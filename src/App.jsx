import { Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider } from './contexts/ConfigContext.jsx';
import Layout from './components/Layout.jsx';
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

function App() {
  return (
    <ConfigProvider>
      <Routes>
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
    </ConfigProvider>
  );
}

export default App;
