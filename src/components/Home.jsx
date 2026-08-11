import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Database, Search, MessageSquare, Bot, Settings, Sparkles, Cpu, Boxes, Globe, Server, Wrench } from 'lucide-react';

// 网页端主要功能入口：把已实现但导航不可达的能力集中到首页，方便在 APP 中直接使用
const cards = [
  { to: '/kbs', title: '知识库', desc: '浏览与管理知识库', icon: Database, color: 'bg-blue-50 text-blue-600' },
  { to: '/search', title: '搜索', desc: '跨库语义/混合检索', icon: Search, color: 'bg-emerald-50 text-emerald-600' },
  { to: '/sessions', title: '会话', desc: '查看对话与提问', icon: MessageSquare, color: 'bg-violet-50 text-violet-600' },
  { to: '/agents', title: '智能体', desc: '管理自定义 Agent', icon: Bot, color: 'bg-amber-50 text-amber-600' },
  { to: '/models', title: '模型', desc: '管理 LLM 模型与提供商', icon: Cpu, color: 'bg-rose-50 text-rose-600' },
  { to: '/vector-stores', title: '向量库', desc: '向量数据库配置', icon: Boxes, color: 'bg-cyan-50 text-cyan-600' },
  { to: '/web-searches', title: '搜索引擎', desc: '联网搜索提供商', icon: Globe, color: 'bg-teal-50 text-teal-600' },
  { to: '/system', title: '系统', desc: '系统状态与解析引擎', icon: Server, color: 'bg-slate-100 text-slate-600' },
  { to: '/diagnostics', title: '诊断', desc: '请求/网络诊断', icon: Wrench, color: 'bg-orange-50 text-orange-600' },
  { to: '/settings', title: '设置', desc: '配置 API 与地址', icon: Settings, color: 'bg-gray-100 text-gray-600' }
];

function Home() {
  const navigate = useNavigate();

  return (
    <div className="p-4">
      <div className="mb-6 rounded-2xl bg-gradient-to-r from-blue-600 to-indigo-600 p-5 text-white shadow-md">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5" />
          <span className="text-sm font-medium opacity-90">WeKnora Mobile</span>
        </div>
        <h2 className="mt-2 text-2xl font-bold">移动知识库助手</h2>
        <p className="mt-1 text-sm opacity-90">随时随地检索、问答、管理知识库。</p>
      </div>

      <h3 className="mb-3 text-sm font-semibold text-gray-500">快捷入口</h3>
      <div className="grid grid-cols-2 gap-3">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.to}
              onClick={() => navigate(card.to)}
              className="flex flex-col items-start rounded-2xl bg-white p-4 shadow-sm transition-transform active:scale-95"
            >
              <div className={clsx('mb-3 rounded-xl p-2', card.color)}>
                <Icon className="h-6 w-6" />
              </div>
              <span className="font-semibold text-gray-900">{card.title}</span>
              <span className="mt-1 text-xs text-gray-500">{card.desc}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default Home;
