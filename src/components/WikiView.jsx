import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Wiki } from '../api/endpoints.js';
import {
  BookOpen, Search, Loader2, AlertCircle, FileText, Folder, ChevronRight,
  BarChart3, LayoutGrid, List, ArrowLeft
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
  const observerRef = useRef();

  const { data: statsRes, loading: statsLoading, error: statsError } = useAsync(
    () => Wiki.getStats(kbId),
    [kbId]
  );
  const stats = statsRes?.data;

  const { data: searchRes, loading: searchLoading } = useAsync(
    () => (debouncedQuery ? Wiki.searchPages(kbId, debouncedQuery, 30) : Promise.resolve(null)),
    [kbId, debouncedQuery]
  );
  const searchResults = debouncedQuery ? extractList(searchRes) : null;

  const { data: listRes, loading: listLoading, error: listError, run: loadList } = useAsync(
    () => Wiki.listPages(kbId, pageParams),
    [kbId, pageParams.page, pageParams.page_size]
  );

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (listRes?.data) {
      const items = Array.isArray(listRes.data) ? listRes.data : listRes.data?.pages || [];
      const total = listRes.total || listRes.data?.total || 0;
      setPages((prev) => (pageParams.page === 1 ? items : [...prev, ...items]));
      setHasMore(items.length > 0 && pages.length + items.length < total);
      setLoadingMore(false);
    }
  }, [listRes]);

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
    try {
      const res = await Wiki.getPage(kbId, page.slug);
      setPageDetail(res.data || res);
    } catch (err) {
      setPageError(err.message || '加载页面失败');
    } finally {
      setPageLoading(false);
    }
  };

  const grouped = groupByType(pages);

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
              {PAGE_TYPE_LABELS[selectedPage.page_type] || selectedPage.page_type}
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
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{pageError}</div>
          ) : pageDetail?.content ? (
            <div className="prose prose-sm max-w-none text-sm text-gray-700">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{pageDetail.content}</ReactMarkdown>
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
          <p className="text-lg font-bold text-gray-900">{stats?.total_pages || 0}</p>
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

      {statsError && (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{statsError.message}</div>
      )}

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
            <PageCard key={page.slug} page={page} onClick={() => handleOpenPage(page)} />
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
            <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{listError.message}</div>
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
                        key={page.slug}
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
                    key={page.slug}
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
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.data)) return res.data;
  if (Array.isArray(res?.data?.pages)) return res.data.pages;
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
        <p className="text-xs text-gray-500 line-clamp-2">{page.summary || page.slug}</p>
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
      <p className="truncate text-xs text-gray-500">{page.summary || page.slug}</p>
    </div>
    <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
  </div>
);

export default WikiView;
