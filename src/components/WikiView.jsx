import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Wiki } from '../api/endpoints.js';
import { get } from '../api/client.js';
import { getBaseUrl, getConfig } from '../config.js';
import {
  BookOpen, Search, Loader2, AlertCircle, FileText, Folder, ChevronRight,
  BarChart3, LayoutGrid, List, ArrowLeft, Bug, Link2
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

const PAGE_TYPE_ORDER = ['summary', 'entity', 'concept', 'synthesis', 'comparison'];
const PAGE_TYPE_LABELS = {
  summary: '摘要',
  entity: '实体',
  concept: '概念',
  synthesis: '综合',
  comparison: '对比'
};
const PAGE_SIZE = 20;

// 分层 slug（如 entity/tencent）按段编码，避免把 "/" 也转义
function encodeSlugPath(slug) {
  if (!slug) return '';
  return String(slug).split('/').map(encodeURIComponent).join('/');
}

// 将 WeKnora 维基语法 [[slug]] / [[slug|Title]] 转换为 Markdown 链接 [Title](wiki:slug)
function preprocessWikiLinks(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (m, slug, title) => {
    const s = String(slug).trim();
    const t = (title && title.trim()) || s;
    if (!s) return m;
    return `[${t}](wiki:${s})`;
  });
}

// 将 HTML 正文里的 [[slug|Title]] 维基语法转换为可点击的 <a class="wiki-link" data-wiki-ref>
function preprocessWikiLinksHtml(html) {
  if (typeof html !== 'string') return '';
  return html.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (m, slug, title) => {
    const s = String(slug).trim().replace(/"/g, '&quot;');
    const t = (title && title.trim()) || String(slug).trim();
    if (!s) return m;
    return `<a class="wiki-link" data-wiki-ref="${s}" href="javascript:void(0)">${t}</a>`;
  });
}

function getMediaBaseUrl() {
  const cfg = getConfig();
  // 优先使用用户配置的绝对地址
  if (cfg.baseUrl && /^https?:\/\//i.test(cfg.baseUrl)) {
    return cfg.baseUrl.replace(/\/$/, '');
  }
  // WebView file:// 环境下 window.location.origin 是空串，不能依赖
  const base = getBaseUrl();
  if (base && /^https?:\/\//i.test(base)) return base;
  // 兜底：如果 baseUrl 是相对路径，尝试拼接
  if (cfg.baseUrl && typeof cfg.baseUrl === 'string') {
    const rel = cfg.baseUrl.replace(/\/$/, '');
    if (rel.startsWith('/')) {
      // 相对路径，需要知道当前页面协议+域名
      // WebView 中从 file:// 加载时无法确定，返回空让调用方处理
      return '';
    }
    return rel;
  }
  return '';
}

function resolveUrl(url) {
  if (!url || typeof url !== 'string') return url;
  url = url.trim();
  // 已经是绝对地址
  if (/^(https?:)?\/\//i.test(url)) return url;
  // 保留 data: / blob: 等 scheme
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  const base = getMediaBaseUrl();
  if (!base) {
    // 无法解析 base，返回原 URL（可能在 WebView 中通过拦截处理）
    return url;
  }
  if (url.startsWith('/')) return `${base}${url}`;
  return `${base}/${url}`;
}

function resolveMediaUrls(html) {
  if (!html || typeof html !== 'string') return html;
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  doc.querySelectorAll('img[src], source[srcset]').forEach((el) => {
    const src = el.getAttribute('src');
    if (src) el.setAttribute('src', resolveUrl(src));
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      el.setAttribute('srcset', srcset.split(',').map((entry) => {
        const parts = entry.trim().split(/\s+/);
        if (!parts[0]) return entry;
        return [resolveUrl(parts[0]), ...parts.slice(1)].join(' ');
      }).join(', '));
    }
  });
  // 标记内部 wiki 链接
  doc.querySelectorAll('a[href]').forEach((el) => {
    const href = el.getAttribute('href') || '';
    if (/^https?:\/\//i.test(href) || href.startsWith('//')) return;
    const isWiki = /\/(wiki|knowledge-bases\/[^/]+\/wiki)\//i.test(href) || /^wiki:/i.test(href);
    const isInternalRelative = !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:');
    if (isWiki || isInternalRelative) {
      el.setAttribute('data-wiki-href', href);
      el.classList.add('wiki-link');
      el.setAttribute('role', 'link');
    }
  });
  return doc.body.innerHTML;
}

function WikiView({ kbId }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [viewMode, setViewMode] = useState('tree');
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
        const meta = res?.data || res;
        if (meta && typeof meta.total_pages === 'number') {
          setHasMore(pageToLoad < meta.total_pages);
        } else {
          setHasMore(items.length === PAGE_SIZE);
        }
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
    if (debouncedQuery) return;
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

  const findPageByRef = useCallback((ref) => {
    if (!ref) return null;
    const norm = (s) => String(s || '').toLowerCase().trim();
    const r = norm(ref);
    const rSeg = r.split('/').pop();
    const matchVal = (val) => {
      const v = norm(val);
      if (!v) return false;
      return v === r || v.split('/').pop() === rSeg;
    };
    return pages.find((p) =>
      matchVal(p.slug) || matchVal(p.id) ||
      (p.title && norm(p.title) === r.replace(/-/g, ' '))
    );
  }, [pages]);

  const handleOpenPage = useCallback(async (page) => {
    setSelectedPage(page);
    setPageLoading(true);
    setPageError(null);
    setPageDetail(null);
    setPageLoadErrors([]);

    const rawId = page.id || page.page_id || page.slug || '';
    const rawSlug = page.slug || page.id || page.page_id || '';
    const seg = encodeSlugPath(rawId || rawSlug);
    const lastSeg = String(rawId || rawSlug).split('/').pop();

    const pathSets = [
      `/knowledge-bases/${kbId}/wiki/pages/`,
      `/knowledge-bases/${kbId}/wiki/page/`,
      `/knowledge-bases/${kbId}/wiki/`,
      `/api/v1/knowledgebase/${kbId}/wiki/pages/`,
      `/api/v1/knowledgebase/${kbId}/wiki/page/`,
      `/knowledgebase/${kbId}/wiki/pages/`
    ];

    const attempts = [];
    for (const prefix of pathSets) {
      for (const id of [seg, encodeSlugPath(rawSlug), rawId, rawSlug, encodeSlugPath(lastSeg), lastSeg]) {
        if (!id) continue;
        const path = prefix + id;
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
    }

    setPageLoadErrors(attempts);
    setPageError('所有 Wiki 详情接口均无法打开该页面，请确认后端路径。');
    setPageLoading(false);
  }, [kbId]);

  const openWikiRef = useCallback((ref) => {
    if (!ref) return;
    const match = findPageByRef(ref);
    if (match) {
      handleOpenPage(match);
    } else {
      handleOpenPage({ slug: ref, id: ref, title: ref });
    }
  }, [findPageByRef, handleOpenPage]);

  const extractWikiSlug = useCallback((raw) => {
    if (!raw || typeof raw !== 'string') return '';
    const href = raw.trim();
    if (href.startsWith('wiki:')) return href.slice(5).trim();
    let path = href.split('?')[0].split('#')[0];
    const kbWikiMatch = path.match(/\/knowledge-bases\/[^/]+\/wiki\/(?:pages|page)\/(.+)/i);
    if (kbWikiMatch) return decodeURIComponent(kbWikiMatch[1].replace(/^\/+|\/+$/g, ''));
    const wikiMatch = path.match(/\/wiki\/(.+)/i);
    if (wikiMatch) return decodeURIComponent(wikiMatch[1].replace(/^\/+|\/+$/g, ''));
    if (!/^https?:\/\//i.test(href) && !href.startsWith('//') && path) {
      return decodeURIComponent(path.split('/').pop().replace(/^\/+|\/+$/g, ''));
    }
    return '';
  }, []);

  // 统一处理链接点击：供 ReactMarkdown 自定义组件和 HTML 内容使用
  const handleLinkClick = useCallback((e, href) => {
    e.preventDefault();
    e.stopPropagation();
    if (href && href.startsWith('wiki:')) {
      openWikiRef(href.slice(5));
      return;
    }
    if (href && /^https?:\/\//i.test(href)) {
      window.open(href, '_blank');
      return;
    }
    const slug = extractWikiSlug(href);
    if (slug) openWikiRef(slug);
  }, [openWikiRef, extractWikiSlug]);

  // 处理 HTML 内容中的链接点击（通过 dangerouslySetInnerHTML 渲染的内容）
  const handleHtmlClick = useCallback((e) => {
    const el = e.target.closest('a[data-wiki-ref], a[data-wiki-href], a.wiki-link');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    const ref = el.getAttribute('data-wiki-ref');
    if (ref) { openWikiRef(ref); return; }
    const href = el.getAttribute('data-wiki-href') || el.getAttribute('href') || '';
    if (href && /^https?:\/\//i.test(href) && !href.includes('/wiki/') && !href.includes('/knowledge-bases/')) {
      window.open(href, '_blank');
      return;
    }
    const slug = extractWikiSlug(href);
    if (slug) openWikiRef(slug);
  }, [openWikiRef, extractWikiSlug]);

  const grouped = groupByType(pages);

  const pageContent = pageDetail?.content || pageDetail?.body || pageDetail?.markdown || pageDetail?.text || pageDetail?.html || '';

  const statsLinks = (stats && typeof stats.total_links === 'number') ? stats.total_links : null;
  const graphLinks = (graph && Array.isArray(graph.edges)) ? graph.edges.length : null;
  const pagesLinkSum = pages.reduce((s, p) =>
    s + (Array.isArray(p.out_links) ? p.out_links.length : 0)
      + (Array.isArray(p.in_links) ? p.in_links.length : 0), 0);
  const totalLinks = statsLinks ?? graphLinks ?? pagesLinkSum ?? 0;

  const totalPages = (stats && typeof stats.total_pages === 'number') ? stats.total_pages : pages.length;
  const pendingIssues = (stats && typeof stats.pending_issues === 'number') ? stats.pending_issues : 0;

  const outLinks = Array.isArray(pageDetail?.out_links) ? pageDetail.out_links : [];
  const inLinks = Array.isArray(pageDetail?.in_links) ? pageDetail.in_links : [];

  // 渲染 Markdown 链接的自定义组件 - 使用 <a> 标签确保 WebView 中可点击
  const renderMarkdownLink = useCallback(({ href, children }) => {
    const onClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleLinkClick(e, href);
    };
    // 统一用 <a> 标签，WebView 中对 <a> 的点击支持最好
    return (
      <a
        href="javascript:void(0)"
        className="wiki-link"
        onClick={onClick}
        role="link"
        style={{ cursor: 'pointer', color: '#2563eb', textDecoration: 'underline' }}
      >{children}</a>
    );
  }, [handleLinkClick]);

  if (selectedPage) {
    const isHtml = isHtmlContent(pageContent);
    const mdSource = preprocessWikiLinks(pageContent);
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
            {selectedPage.title || pageDetail?.title}
          </h2>
        </header>
        <div className="flex-1 overflow-y-auto no-scrollbar pb-20">
          <div className="p-4">
            <div className="rounded-2xl bg-white p-4 shadow-sm">
              <div className="mb-3 flex flex-wrap gap-2">
                <span className="rounded-lg bg-blue-50 px-2 py-1 text-xs text-blue-600">
                  {PAGE_TYPE_LABELS[selectedPage.page_type || pageDetail?.page_type] || (selectedPage.page_type || pageDetail?.page_type) || '页面'}
                </span>
                {(selectedPage.version || pageDetail?.version) && (
                  <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">
                    v{selectedPage.version || pageDetail?.version}
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
                <>
                  <div className="md-body" onClick={isHtml ? handleHtmlClick : undefined}>
                    {isHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: cleanHtml(resolveMediaUrls(preprocessWikiLinksHtml(pageContent))) }} />
                    ) : (
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm, remarkMath]}
                        rehypePlugins={[rehypeKatex]}
                        components={{
                          a: renderMarkdownLink,
                          img: ({ src, alt, title }) => (
                            <img
                              src={resolveUrl(src)}
                              alt={alt || ''}
                              title={title}
                              loading="lazy"
                              className="max-w-full rounded-lg"
                            />
                          )
                        }}
                      >{mdSource}</ReactMarkdown>
                    )}
                  </div>

                  {(outLinks.length > 0 || inLinks.length > 0) && (
                    <div className="mt-5 border-t border-gray-100 pt-4">
                      {outLinks.length > 0 && (
                        <LinkSection title="本页链接" links={outLinks} onOpen={openWikiRef} />
                      )}
                      {inLinks.length > 0 && (
                        <LinkSection title="反向链接" links={inLinks} onOpen={openWikiRef} />
                      )}
                    </div>
                  )}
                </>
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

function LinkSection({ title, links, onOpen }) {
  return (
    <div className="mb-3">
      <p className="mb-2 flex items-center gap-1 text-xs font-semibold text-gray-500">
        <Link2 className="h-3.5 w-3.5" /> {title}（{links.length}）
      </p>
      <div className="flex flex-wrap gap-2">
        {links.map((ref, i) => (
          <button
            key={i}
            onClick={() => onOpen(ref)}
            className="rounded-full bg-blue-50 px-3 py-1.5 text-xs text-blue-700 active:scale-95"
          >
            {ref}
          </button>
        ))}
      </div>
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

function isHtmlContent(text) {
  if (typeof text !== 'string') return false;
  const tagPattern = /<[^\s<>/][^<>]*>/i;
  const hasHtmlTags = tagPattern.test(text);
  const hasMarkdown = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\[.*\]\(.*\)|^\*\*.*\*\*|^__.*__|^`.*`|^```/m.test(text);
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
