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
  const [pageParams, setPageParams] = useState({ page: 1, page_size: 20 });
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

  const { data: searchRes, loading: searchLoading } = useAsync(
    () => (debouncedQuery ? Wiki.searchPages(kbId, debouncedQuery, 30).catch(() => null) : Promise.resolve(null)),
    [kbId, debouncedQuery]
  );
  const searchResults = debouncedQuery ? extractList(searchRes) : null;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  const loadPages = useCallback(async () => {
    setListLoading(true);
    setListError(null);
    setLoadErrors([]);

    const attempts = [];

    // Try 1: listPages
    try {
      const res = await Wiki.listPages(kbId, pageParams);
      attempts.push({ source: 'Wiki.listPages', ok: true, status: 'success' });
      handleListResponse(res);
      setListLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'Wiki.listPages', ok: false, error: err.message });
    }

    // Try 2: getIndex
    try {
      const res = await Wiki.getIndex(kbId, pageParams);
      attempts.push({ source: 'Wiki.getIndex', ok: true, status: 'success' });
      handleListResponse(res);
      setListLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'Wiki.getIndex', ok: false, error: err.message });
    }

    // Try 3: plain wiki root
    try {
      const res = await get(`/knowledge-bases/${kbId}/wiki`, pageParams);
      attempts.push({ source: 'GET /knowledge-bases/{id}/wiki', ok: true, status: 'success' });
      handleListResponse(res);
      setListLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'GET /knowledge-bases/{id}/wiki', ok: false, error: err.message });
    }

    // Try 4: old /api/knowledgebase path (legacy)
    try {
      const res = await get(`/knowledgebase/${kbId}/wiki/pages`, pageParams);
      attempts.push({ source: 'GET /knowledgebase/{id}/wiki/pages (legacy)', ok: true, status: 'success' });
      handleListResponse(res);
      setListLoading(false);
      return;
    } catch (err) {
      attempts.push({ source: 'GET /knowledgebase/{id}/wiki/pages (legacy)', ok: false, error: err.message });
    }

    setLoadErrors(attempts);
    setListError('所有 Wiki 页面接口均无法获取数据，请确认该知识库已启用 Wiki 并检查后端版本。');
    setPages((prev) => (pageParams.page === 1 ? [] : prev));
    setHasMore(false);
    setLoadingMore(false);
    setListLoading(false);
  }, [kbId, pageParams]);

  const handleListResponse = useCallback((res) => {
    const items = extractList(res);
    const total = res?.total || res?.data?.total || res?.pagination?.total || items.length;
    setPages((prev) => (pageParams.page === 1 ? items : [...prev, ...items]));
    setHasMore(items.length > 0 && pages.length + items.length < total);
    setLoadingMore(false);
  }, [pageParams.page, pages.length]);

  useEffect(() => {
    loadPages();
  }, [loadPages]);

  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore || debouncedQuery) return;
    setLoadingMore(true);
    setPageParams((p) => ({ ...p, page: p.page + 1 }));
  }, [loadingMore, hasMore, debouncedQuery]);

  const lastItemRef = useCallback((node) => {
    if (listLoading || loadingMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '100px' });
    if (node) observerRef.current.observe(node);
  }, [listLoading, loadingMore, loadMore]);

  const handleOpenPage = async (page) => {
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
  };

  const grouped = groupByType(pages);

  const pageContent = pageDetail?.content || pageDetail?.body || pageDetail?.markdown || pageDetail?.text || pageDetail?.html || '';

  if (selectedPage) {
    return (
      <div className="p-4">
        <button
          onClick={() => { setSelectedPage(null); setPageDetail(null); }}
          className="mb-3 flex items-center gap-1 text-sm text-gray-600"
        >
          <ArrowLeft className="h-4 w-4" /> 返回 Wiki
        </button>
        <div className="rounded-2xl bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-lg font-bold text-gray-900">{selectedPage.title}</h3>
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
            <div className="prose prose-sm max-w-none text-sm text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{pageContent}</ReactMarkdown>
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-gray-400">暂无内容</div>
          )}
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
          <p className="text-lg font-bold text-gray-900">{stats?.total_pages ?? pages.length ?? 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm text-center">
          <BookOpen className="mx-auto mb-1 h-5 w-5 text-green-600" />
          <p className="text-xs text-gray-500">链接</p>
          <p className="text-lg font-bold text-gray-900">{stats?.total_links || 0}</p>
        </div>
        <div className="rounded-2xl bg-white p-3 shadow-sm text-center">
          <AlertCircle className="mx-auto mb-1 h-5 w-5 text-amber-600" />
          <p className="text-xs text-gray-500">问题</p>
          <p className="text-lg font-bold text-gray-900">{stats?.pending_issues || 0}</p>
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
          {listLoading && pageParams.page === 1 && (
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

          {(loadingMore || listLoading) && pageParams.page > 1 && (
            <div className="py-3 text-center text-sm text-gray-500">
              <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 加载中…
            </div>
          )}

          {!hasMore && pages.length > 0 && !debouncedQuery && (
            <div className="py-3 text-center text-xs text-gray-400">已加载全部 Wiki 页面</div>
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

function groupByType(pages) {
  return pages.reduce((acc, page) => {
    const type = page.page_type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(page);
    return acc;
  }, {});
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
