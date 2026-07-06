import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Wiki } from '../api/endpoints.js';
import { get } from '../api/client.js';
import {
  BookOpen, Search, Loader2, AlertCircle, FileText, Folder, ChevronRight,
  BarChart3, LayoutGrid, List, ArrowLeft, Bug
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const PAGE_TYPE_ORDER = ['summary', 'entity', 'concept', 'synthesis', 'comparison'];
const PAGE_TYPE_LABELS = {
  summary: '摘要',
  entity: '实体',
  concept: '概念',
  synthesis: '综合',
  comparison: '对比'
};
const PAGE_SIZE = 20;

function WikiView({ kbId }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [viewMode, setViewMode] = useState('tree'); // tree | list
  const [selectedPage, setSelectedPage] = useState(null);
  const [pageDetail, setPageDetail] = useState(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState(null);
  const [pages, setPages] = useState([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState(null);
  const [loadErrors, setLoadErrors] = useState([]);
  const [showDebug, setShowDebug] = useState(false);
  const [pageLoadErrors, setPageLoadErrors] = useState([]);
  const [showPageDebug, setShowPageDebug] = useState(false);
  const observerRef = useRef();

  const { data: statsRes, loading: statsLoading } = useAsync(
    () => Wiki.getStats(kbId).catch(() => null),
    [kbId]
  );
  const stats = statsRes?.data || statsRes;

  // 用知识图谱的边数作为「链接」数量的兜底数据源（wiki 页面之间的链接）
  const { data: graphRes } = useAsync(
    () => Wiki.getGraph(kbId).catch(() => null),
    [kbId]
  );
  const graph = graphRes?.data || graphRes;

  const { data: searchRes, loading: searchLoading } = useAsync(
    () => (debouncedQuery ? Wiki.searchPages(kbId, debouncedQuery, 30).catch(() => null) : Promise.resolve(null)),
    [kbId, debouncedQuery]
  );
  const searchResults = debouncedQuery ? extractList(searchRes) : null;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  // 分页参数变化时重置页码
  useEffect(() => {
    setPage(1);
    setPages([]);
    setHasMore(true);
  }, [kbId, debouncedQuery]);

  const loadPages = useCallback(async (pageToLoad, isAppend = false) => {
    if (pageToLoad === 1) setListLoading(true);
    else setLoadingMore(true);
    setListError(null);
    setLoadErrors([]);

    const params = { page: pageToLoad, page_size: PAGE_SIZE };
    const attempts = [];

    const tryFetch = async (label, fn) => {
      try {
        const res = await fn();
        attempts.push({ source: label, ok: true, status: 'success' });
        const items = extractList(res);
        setPages((prev) => (pageToLoad === 1 ? items : [...prev, ...items]));
        // 后端返回满一页时继续加载，返回不足一页或空时结束
        setHasMore(items.length === PAGE_SIZE);
        return true;
      } catch (err) {
        attempts.push({ source: label, ok: false, error: err.message });
        return false;
      }
    };

    const ok = await tryFetch('Wiki.listPages', () => Wiki.listPages(kbId, params))
      || await tryFetch('Wiki.getIndex', () => Wiki.getIndex(kbId, params))
      || await tryFetch('GET /knowledge-bases/{id}/wiki', () => get(`/knowledge-bases/${kbId}/wiki`, params))
      || await tryFetch('GET /knowledgebase/{id}/wiki/pages (legacy)', () => get(`/knowledgebase/${kbId}/wiki/pages`, params));

    if (!ok) {
      setLoadErrors(attempts);
      setListError('所有 Wiki 页面接口均无法获取数据，请确认该知识库已启用 Wiki 并检查后端版本。');
      if (pageToLoad === 1) setPages([]);
      setHasMore(false);
    }

    setListLoading(false);
    setLoadingMore(false);
  }, [kbId]);

  useEffect(() => {
    if (debouncedQuery) return; // 搜索时不自动加载
    loadPages(page, page > 1);
  }, [debouncedQuery, loadPages, page]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || debouncedQuery) return;
    setPage((p) => p + 1);
  }, [loadingMore, hasMore, debouncedQuery]);

  const lastItemRef = useCallback((node) => {
    if (listLoading || loadingMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '100px' });
    if (node) observerRef.current.observe(node);
  }, [listLoading, loadingMore, loadMore]);

  const handleOpenPage = useCallback(async (page) => {
    setSelectedPage(page);
    setPageLoading(true);
    setPageError(null);
    setPageDetail(null);
    setPageLoadErrors([]);

    const id = page.id || page.page_id || page.slug || '';
    const slug = page.slug || page.id || page.page_id || '';
    const paths = [
      `/knowledge-bases/${kbId}/wiki/pages/${encodeURIComponent(id)}`,
      `/knowledge-bases/${kbId}/wiki/pages/${encodeURIComponent(slug)}`,
      `/knowledge-bases/${kbId}/wiki/page/${encodeURIComponent(id)}`,
      `/knowledge-bases/${kbId}/wiki/page/${encodeURIComponent(slug)}`,
      `/knowledge-bases/${kbId}/wiki/${encodeURIComponent(id)}`,
      `/knowledge-bases/${kbId}/wiki/${encodeURIComponent(slug)}`,
      `/knowledgebase/${kbId}/wiki/pages/${encodeURIComponent(id)}`,
      `/knowledgebase/${kbId}/wiki/pages/${encodeURIComponent(slug)}`,
    ];

    const attempts = [];
    for (const path of paths) {
      try {
        const res = await get(path);
        attempts.push({ source: path, ok: true, status: 'success' });
        setPageLoadErrors(attempts);
        setPageDetail(res?.data || res);
        setPageLoading(false);
        return;
      } catch (err) {
        attempts.push({ source: path, ok: false, error: err.message });
      }
    }

    setPageLoadErrors(attempts);
    setPageError('所有 Wiki 详情接口均无法打开该页面，请确认后端路径。');
    setPageLoading(false);
  }, [kbId]);

  // 点击 wiki 内容里的链接（MD 或 HTML 渲染出的 <a>）时在应用内跳转
  const openWikiLink = useCallback((href) => {
    if (!href) return;
    // 外部链接：尽力在新窗口打开
    if (/^https?:\/\//i.test(href)) {
      try { window.open(href, '_blank'); } catch {}
      return;
    }
    // 提取 /wiki/ 之后的最后一段作为 slug
    let seg = href.split('/wiki/').pop();
    seg = (seg || '').split('?')[0].split('#')[0].replace(/^\/+|\/+$/g, '');
    const slug = decodeURIComponent(seg);
    if (!slug) return;
    const match = pages.find((p) =>
      p.slug === slug || p.id === slug || p.page_id === slug ||
      (p.slug && p.slug.toLowerCase() === slug.toLowerCase()) ||
      (p.title && p.title.toLowerCase() === slug.toLowerCase().replace(/-/g, ' '))
    );
    if (match) {
      handleOpenPage(match);
    } else {
      // 兜底：直接尝试用 slug 打开
      handleOpenPage({ slug, id: slug, title: slug });
    }
  }, [pages, handleOpenPage]);

  const handleContentClick = useCallback((e) => {
    const a = e.target.closest('a');
    if (!a) return;
    const href = a.getAttribute('href');
    if (!href) return;
    e.preventDefault();
    openWikiLink(href);
  }, [openWikiLink]);

  const grouped = groupByType(pages);

  const pageContent = pageDetail?.content || pageDetail?.body || pageDetail?.markdown || pageDetail?.text || pageDetail?.html || '';

  // 从 stats / 图谱 / 页面 多源兜底计算「链接」数量
  const totalLinks = pickLinkCount(stats)
    ?? graphLinkCount(graph)
    ?? pagesLinkCount(pages)
    ?? 0;

  // 页面数：优先 stats，否则已加载页数
  const totalPages = stats && hasKey(stats, 'total_pages') ? stats.total_pages : pages.length;
  const pendingIssues = stats && hasKey(stats, 'pending_issues') ? stats.pending_issues : 0;

  if (selectedPage) {
    const isHtml = isHtmlContent(pageContent);
    return (
      <div className="fixed inset-0 z-40 flex flex-col bg-gray-50">
        <header className="safe-top flex items-center gap-2 bg-white px-4 py-3 shadow-sm">
          <button
            onClick={() => { setSelectedPage(null); setPageDetail(null); }}
            className="flex items-center gap-1 text-sm text-gray-600 active:scale-95"
          >
            <ArrowLeft className="h-5 w-5" /> 返回
          </button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900">
            {selectedPage.title}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
          <div className="p-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-600">
                  {PAGE_TYPE_LABELS[selectedPage.page_type] || selectedPage.page_type || '页面'}
                </span>
                {selectedPage.version && (
                  <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">
                    v{selectedPage.version}
                  </span>
                )}
              </div>
              {pageLoading ? (
                <div className="py-8 text-center text-sm text-gray-500">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载中…
                </div>
              ) : pageError ? (
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  <p className="font-medium">{pageError}</p>
                  <button
                    onClick={() => setShowPageDebug((s) => !s)}
                    className="mt-2 flex items-center gap-1 text-xs text-gray-600"
                  >
                    <Bug className="h-3 w-3" /> {showPageDebug ? '隐藏调试' : '显示调试'}
                  </button>
                  {showPageDebug && pageLoadErrors.length > 0 && (
                    <div className="mt-2 rounded-lg bg-gray-900 p-2 text-xs text-gray-100">
                      {pageLoadErrors.map((a, i) => (
                        <div key={i} className={a.ok ? 'text-green-400' : 'text-red-400'}>
                          {a.ok ? '✓' : '✗'} {a.source}: {a.ok ? a.status : a.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : pageContent ? (
                <div
                  className="md-body"
                  onClick={handleContentClick}
                >
                  {isHtml ? (
                    <div dangerouslySetInnerHTML={{ __html: cleanHtml(pageContent) }} />
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{pageContent}</ReactMarkdown>
                  )}
                </div>
              ) : (
                <div className="py-8 text-center text-sm text-gray-400">暂无内容</div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-2xl bg-white p-3 shadow-sm text-center">
          <BarChart3 className="mx-auto mb-1 h-5 w-5 text-blue-600" />
          <p className="text-xs text-gray-500">页面</p>
          <p className="text-lg font-bold text-gray-900">
            {statsLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : totalPages}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm text-center">
          <BookOpen className="mx-auto mb-1 h-5 w-5 text-green-600" />
          <p className="text-xs text-gray-500">链接</p>
          <p className="text-lg font-bold text-gray-900">
            {statsLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : totalLinks}
          </p>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm text-center">
          <AlertCircle className="mx-auto mb-1 h-5 w-5 text-amber-600" />
          <p className="text-xs text-gray-500">问题</p>
          <p className="text-lg font-bold text-gray-900">
            {statsLoading ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : pendingIssues}
          </p>
        </div>
      </div>

      {/* Search and view mode */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索 Wiki 页面…"
            className="w-full rounded-xl border border-gray-300 py-2.5 pl-9 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => setViewMode(viewMode === 'tree' ? 'list' : 'tree')}
          className="rounded-xl bg-white p-2.5 shadow-sm text-gray-600"
          title={viewMode === 'tree' ? '切换为列表' : '切换为树形'}
        >
          {viewMode === 'tree' ? <List className="h-5 w-5" /> : <LayoutGrid className="h-5 w-5" />}
        </button>
      </div>

      {/* Debug toggle */}
      {(loadErrors.length > 0 || listError) && (
        <button
          onClick={() => setShowDebug((s) => !s)}
          className="flex items-center gap-1 text-xs text-gray-500"
        >
          <Bug className="h-3 w-3" /> {showDebug ? '隐藏调试信息' : '显示调试信息'}
        </button>
      )}
      {showDebug && loadErrors.length > 0 && (
        <div className="rounded-xl bg-gray-900 p-3 text-xs text-gray-100">
          <p className="mb-1 font-semibold">接口尝试记录：</p>
          <ul className="space-y-1">
            {loadErrors.map((a, i) => (
              <li key={i} className={a.ok ? 'text-green-400' : 'text-red-400'}>
                {a.ok ? '✓' : '✗'} {a.source}: {a.ok ? a.status : a.error}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Search results */}
      {debouncedQuery && (
        <div className="space-y-2">
          {searchLoading && (
            <div className="py-4 text-center text-sm text-gray-500">
              <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 搜索中…
            </div>
          )}
          {searchResults?.length === 0 && (
            <div className="py-4 text-center text-sm text-gray-500">未找到相关页面</div>
          )}
          {searchResults?.map((page) => (
            <PageCard key={page.slug || page.id} page={page} onClick={() => handleOpenPage(page)} />
          ))}
        </div>
      )}

      {!debouncedQuery && (
        <div className="space-y-3">
          {listLoading && page === 1 && (
            <div className="py-8 text-center text-sm text-gray-500">
              <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载 Wiki…
            </div>
          )}
          {listError && (
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
              <p className="font-medium">{listError}</p>
              <p className="mt-1 text-xs">建议：在网页端打开 Wiki，按 F12 查看 Network 里实际请求的接口路径，然后反馈给我。</p>
            </div>
          )}

          {!listLoading && !listError && pages.length === 0 && (
            <div className="py-8 text-center text-sm text-gray-500">
              <BookOpen className="mx-auto mb-2 h-8 w-8 text-gray-300" />
              <p>暂无 Wiki 页面</p>
              <p className="mt-1 text-xs text-gray-400">如果网页端有内容，请确认知识库已启用 Wiki，或点击上方「显示调试信息」查看接口返回。</p>
            </div>
          )}

          {viewMode === 'tree' ? (
            PAGE_TYPE_ORDER.map((type) => {
              const items = grouped[type] || [];
              if (items.length === 0) return null;
              return (
                <div key={type} className="rounded-2xl bg-white p-3 shadow-sm">
                  <h4 className="mb-2 text-sm font-semibold text-gray-900">
                    {PAGE_TYPE_LABELS[type] || type}
                    <span className="ml-1 text-xs font-normal text-gray-500">({items.length})</span>
                  </h4>
                  <div className="space-y-1">
                    {items.map((page, idx) => (
                      <PageItem
                        key={page.slug || page.id}
                        page={page}
                        onClick={() => handleOpenPage(page)}
                        ref={idx === items.length - 1 ? lastItemRef : null}
                      />
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-2xl bg-white p-3 shadow-sm">
              <div className="space-y-1">
                {pages.map((page, idx) => (
                  <PageItem
                    key={page.slug || page.id}
                    page={page}
                    onClick={() => handleOpenPage(page)}
                    ref={idx === pages.length - 1 ? lastItemRef : null}
                  />
                ))}
              </div>
            </div>
          )}

          {(loadingMore || listLoading) && page > 1 && (
            <div className="py-3 text-center text-sm text-gray-500">
              <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 加载中…
            </div>
          )}

          {!hasMore && pages.length > 0 && !debouncedQuery && (
            <div className="py-3 text-center text-xs text-gray-400">已加载全部 {pages.length} 个 Wiki 页面</div>
          )}
        </div>
      )}
    </div>
  );
}

function extractList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  const data = res.data ?? res;
  if (Array.isArray(data)) return data;
  const candidates = [data?.pages, data?.items, data?.results, data?.records, data?.list, data?.data];
  for (const c of candidates) {
    if (Array.isArray(c)) return c;
  }
  return [];
}

function hasKey(obj, key) {
  return obj && typeof obj === 'object' && key in obj;
}

function groupByType(pages) {
  return pages.reduce((acc, page) => {
    const type = page.page_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(page);
    return acc;
  }, {});
}

// 真实链接数提取：stats 中多种可能字段名
function pickLinkCount(stats) {
  if (!stats || typeof stats !== 'object') return null;
  const keys = ['total_links', 'links', 'link_count', 'total_link_count', 'wiki_links', 'total_link', 'links_count'];
  for (const k of keys) {
    if (typeof stats[k] === 'number') return stats[k];
  }
  if (Array.isArray(stats.links)) return stats.links.length;
  if (Array.isArray(stats.link_list)) return stats.link_list.length;
  return null;
}

function graphLinkCount(graph) {
  if (!graph) return null;
  const edges = graph.edges || graph.data?.edges || graph.links || graph.data?.links;
  if (Array.isArray(edges)) return edges.length;
  return null;
}

function pagesLinkCount(pages) {
  return pages.reduce((sum, p) => {
    const c =
      p.link_count ??
      (Array.isArray(p.links) ? p.links.length : null) ??
      p.links_count ??
      (Array.isArray(p.outgoing_links) ? p.outgoing_links.length : null) ??
      (Array.isArray(p.relations) ? p.relations.length : null) ??
      (Array.isArray(p.references) ? p.references.length : null) ??
      0;
    return sum + (typeof c === 'number' ? c : 0);
  }, 0);
}

function isHtmlContent(text) {
  if (typeof text !== 'string') return false;
  const tagPattern = /<[^\s<>/][^<>]*>/i;
  const hasHtmlTags = tagPattern.test(text);
  const hasMarkdown = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\[.*\]\(.*\)|^\*\*.*\*\*|^__.*__|^`.*`|^```/m.test(text);
  // 如果包含明显 HTML 标签且不像 Markdown，按 HTML 渲染
  return hasHtmlTags && !hasMarkdown;
}

function cleanHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/on\w+\s*=/gi, 'data-disabled=')
    .replace(/javascript:/gi, 'disabled:');
}

function PageCard({ page, onClick }) {
  return (
    <div
      onClick={onClick}
      className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm active:scale-95"
    >
      <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
        <FileText className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h4 className="text-sm font-semibold text-gray-900">{page.title}</h4>
        <p className="text-xs text-gray-500 line-clamp-2">{page.summary || page.slug || page.id}</p>
      </div>
      <ChevronRight className="h-5 w-5 text-gray-400" />
    </div>
  );
}

const PageItem = ({ page, onClick, ref }) => (
  <div
    ref={ref}
    onClick={onClick}
    className="flex items-center gap-2 rounded-xl p-2 active:bg-gray-50"
  >
    <Folder className="h-4 w-4 shrink-0 text-gray-400" />
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-medium text-gray-900">{page.title}</p>
      <p className="truncate text-xs text-gray-500">{page.summary || page.slug || page.id}</p>
    </div>
    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
  </div>
);

export default WikiView;
