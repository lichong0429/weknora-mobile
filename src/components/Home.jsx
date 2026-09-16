import { useNavigate, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import { useAsync } from '../hooks/useApi.js';
import { useConfig } from '../contexts/ConfigContext.jsx';
import { KB, Session } from '../api/endpoints.js';
import { extractList } from '../utils/list.js';
import {
  Database, Search, MessageSquare, Bot, Sparkles, FileText, Pin, ChevronRight,
  Layers, Loader2, AlertCircle, RefreshCw
} from 'lucide-react';

// 首页仅保留四个核心入口，其余管理功能统一收纳在「设置」页
const cards = [
  { to: '/kbs', title: '知识库', desc: '浏览与管理', icon: Database, box: 'bg-brand-50 text-brand-600' },
  { to: '/search', title: '搜索', desc: '跨库语义检索', icon: Search, box: 'bg-emerald-50 text-emerald-600' },
  { to: '/sessions', title: '会话', desc: '查看对话与提问', icon: MessageSquare, box: 'bg-violet-50 text-violet-500' },
  { to: '/agents', title: '智能体', desc: '管理自定义 Agent', icon: Bot, box: 'bg-amber-50 text-amber-500' }
];

// 知识库条目的图标配色（按索引轮转，保证同一条目配色稳定）
const RECENT_STYLES = [
  { icon: Database, box: 'bg-brand-50 text-brand-600' },
  { icon: FileText, box: 'bg-amber-50 text-amber-500' },
  { icon: Layers, box: 'bg-emerald-50 text-emerald-600' }
];

function formatNumber(n) {
  if (n == null || Number.isNaN(Number(n))) return '—';
  return Number(n).toLocaleString('en-US');
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diffMin = Math.floor((Date.now() - t) / 60000);
  if (diffMin < 1) return '刚刚';
  if (diffMin < 60) return `${diffMin} 分钟前`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} 小时前`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay} 天前`;
  return new Date(iso).toLocaleDateString();
}

function Home() {
  const navigate = useNavigate();
  const location = useLocation();
  const { config } = useConfig();

  // 依赖 location.key：每次进入首页都重新拉取，保证概览数据新鲜
  const { data: kbRes, loading: kbLoading, error: kbError, run: runKb } = useAsync(
    () => KB.list(),
    [location.key, config.baseUrl, config.apiKey]
  );
  const { data: sessionRes, run: runSessions } = useAsync(
    () => Session.list({ page: 1, page_size: 100 }),
    [location.key, config.baseUrl, config.apiKey]
  );

  const kbs = extractList(kbRes);
  const sessions = extractList(sessionRes);

  const loading = kbLoading;
  const docCount = kbs.reduce((sum, kb) => sum + (Number(kb.knowledge_count) || 0), 0);
  // 会话总数优先取后端返回的 total，缺失时退回当前页条数
  const sessionCount = sessionRes?.total ?? sessionRes?.data?.total ?? sessions.length;

  const stats = [
    { value: loading ? '…' : formatNumber(kbs.length), label: '知识库', color: 'text-brand-600' },
    { value: loading ? '…' : formatNumber(docCount), label: '文档', color: 'text-emerald-600' },
    { value: loading ? '…' : formatNumber(sessionCount), label: '会话', color: 'text-violet-500' }
  ];

  // 最近访问：按更新时间倒序取前 3 个知识库
  const recents = [...kbs]
    .sort((a, b) => {
      const ta = new Date(b?.updated_at || b?.created_at || 0).getTime() || 0;
      const tb = new Date(a?.updated_at || a?.created_at || 0).getTime() || 0;
      return ta - tb;
    })
    .slice(0, 3);

  const handleRefresh = () => {
    runKb();
    runSessions();
  };

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
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-ink">数据概览</h3>
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="flex items-center gap-1 text-xs font-medium text-brand-600 disabled:opacity-50"
          >
            <RefreshCw className={clsx('h-3.5 w-3.5', loading && 'animate-spin')} /> 刷新
          </button>
        </div>

        {kbError && (
          <div className="mb-3 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>统计数据加载失败：{kbError}</span>
          </div>
        )}

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

        {loading && recents.length === 0 ? (
          <div className="flex items-center justify-center rounded-2xl bg-white py-8 text-ink-muted shadow-card">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 加载中…
          </div>
        ) : recents.length === 0 ? (
          <div className="rounded-2xl bg-white p-4 text-center text-xs text-ink-muted shadow-card">
            暂无知识库，去「知识库」页新建一个吧
          </div>
        ) : (
          <div className="space-y-3">
            {recents.map((kb, idx) => {
              const style = RECENT_STYLES[idx % RECENT_STYLES.length];
              const Icon = style.icon;
              const count = Number(kb.knowledge_count) || 0;
              const updated = relativeTime(kb.updated_at || kb.created_at);
              return (
                <button
                  key={kb.id}
                  onClick={() => navigate(`/kb/${kb.id}`)}
                  className="flex w-full items-center gap-3 rounded-2xl bg-white p-3.5 text-left shadow-card transition-transform active:scale-[0.98]"
                >
                  <div className={clsx('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', style.box)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{kb.name}</div>
                    <div className="mt-0.5 truncate text-[11px] text-ink-muted">
                      {count} 文档{updated ? ` · 更新于 ${updated}` : ''}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" />
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* 底部置顶提示 */}
      <div className="flex items-center justify-center gap-1.5 py-2 text-[11px] text-ink-faint">
        <Pin className="h-3 w-3" /> 更多功能请在底部导航探索
      </div>
    </div>
  );
}

export default Home;
