import { useNavigate } from 'react-router-dom';
import { clsx } from 'clsx';
import { Database, Search, MessageSquare, Bot, Sparkles, FileText, Pin, ChevronRight, Layers } from 'lucide-react';

// 首页仅保留四个核心入口，其余管理功能统一收纳在「设置」页
const cards = [
  { to: '/kbs', title: '知识库', desc: '浏览与管理', icon: Database, box: 'bg-brand-50 text-brand-600' },
  { to: '/search', title: '搜索', desc: '跨库语义检索', icon: Search, box: 'bg-emerald-50 text-emerald-600' },
  { to: '/sessions', title: '会话', desc: '查看对话与提问', icon: MessageSquare, box: 'bg-violet-50 text-violet-500' },
  { to: '/agents', title: '智能体', desc: '管理自定义 Agent', icon: Bot, box: 'bg-amber-50 text-amber-500' }
];

const stats = [
  { value: '12', label: '知识库', color: 'text-brand-600' },
  { value: '3,842', label: '文档', color: 'text-emerald-600' },
  { value: '56', label: '会话', color: 'text-violet-500' }
];

const recents = [
  { name: 'MOF 玻璃态材料', detail: '128 文档 · 更新于 2 小时前', icon: Database, box: 'bg-brand-50 text-brand-600' },
  { name: '膜分离技术 FAQ', detail: '35 条目 · 更新于 昨天', icon: FileText, box: 'bg-amber-50 text-amber-500' },
  { name: '分子动力学模拟', detail: '62 文档 · 更新于 3 天前', icon: Layers, box: 'bg-emerald-50 text-emerald-600' }
];

function Home() {
  const navigate = useNavigate();

  return (
    <div className="p-4 space-y-5">
      {/* 品牌 Hero */}
      <div className="rounded-[24px] bg-gradient-to-br from-brand-600 via-brand-500 to-violet-500 p-6 text-white shadow-brand-lg">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          <span className="text-xs font-medium opacity-90">WeKnora Mobile</span>
        </div>
        <h2 className="mt-2 text-[26px] leading-9 font-bold">移动知识库助手</h2>
        <p className="mt-1 text-[13px] opacity-85">随时随地检索、问答、管理你的知识库</p>

        <button
          onClick={() => navigate('/search')}
          className="mt-4 flex w-full items-center gap-2.5 rounded-[14px] bg-white/15 px-4 py-3.5 backdrop-blur transition-colors hover:bg-white/25 active:scale-[0.98]"
        >
          <Search className="h-[18px] w-[18px]" />
          <span className="flex-1 text-left text-[13px] opacity-85">搜索知识库或文档…</span>
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium">去提问</span>
        </button>
      </div>

      {/* 快捷入口 */}
      <section>
        <h3 className="mb-3 text-base font-semibold text-ink">快捷入口</h3>
        <div className="grid grid-cols-2 gap-3">
          {cards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.to}
                onClick={() => navigate(card.to)}
                className="flex flex-col items-start rounded-[20px] bg-white p-4 shadow-card transition-transform active:scale-[0.96]"
              >
                <div className={clsx('mb-3 rounded-[13px] p-2.5', card.box)}>
                  <Icon className="h-5 w-5" />
                </div>
                <span className="font-semibold text-ink">{card.title}</span>
                <span className="mt-0.5 text-xs text-ink-muted">{card.desc}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* 数据概览 */}
      <section>
        <h3 className="mb-3 text-base font-semibold text-ink">数据概览</h3>
        <div className="grid grid-cols-3 gap-3">
          {stats.map((s) => (
            <div key={s.label} className="rounded-[18px] bg-white p-4 shadow-card">
              <div className={clsx('text-2xl font-bold', s.color)}>{s.value}</div>
              <div className="mt-1 text-xs text-ink-muted">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* 最近访问 */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">最近访问</h3>
          <button onClick={() => navigate('/kbs')} className="flex items-center text-xs font-medium text-brand-600">
            查看全部 <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="space-y-3">
          {recents.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.name}
                onClick={() => navigate('/kbs')}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-card transition-transform active:scale-[0.98]"
              >
                <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', item.box)}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-ink">{item.name}</div>
                  <div className="mt-0.5 truncate text-[11px] text-ink-muted">{item.detail}</div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
              </button>
            );
          })}
        </div>
      </section>

      {/* 底部置顶提示 */}
      <div className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-ink-faint">
        <Pin className="h-3 w-3" /> 更多功能请在底部导航探索
      </div>
    </div>
  );
}

export default Home;
