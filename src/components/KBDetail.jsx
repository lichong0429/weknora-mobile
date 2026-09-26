import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { KB, Knowledge, Tag, Session } from '../api/endpoints.js';
import KBSettings from './KBSettings.jsx';
import WikiView from './WikiView.jsx';
import GraphView from './GraphView.jsx';
import FAQView from './FAQView.jsx';
import TagManager from './TagManager.jsx';
import CreateKnowledgeModal from './CreateKnowledgeModal.jsx';
import KBEval from './KBEval.jsx';
import UploadTaskPanel from './UploadTaskPanel.jsx';
import { useUploadQueue } from '../hooks/useUploadQueue.js';
import { useParsePolling } from '../hooks/useParsePolling.js';
import { isInFlight, statusMeta, formatBytes } from '../utils/parseStatus.js';
import { SOURCE_LABEL } from '../utils/labels.js';
import { saveFile, safeFileName } from '../utils/nativeDownload.js';
import {
  FileText, Search, Settings, Upload, Loader2, AlertCircle,
  ChevronRight, Trash2, File, Link, PenLine, Database, RefreshCw,
  Filter, X, CheckSquare, Square, BookOpen, Share2,
  Tag as TagIcon, HelpCircle, Plus, BarChart3, MessageSquare,
  Ban, RotateCcw, Zap, Download
} from 'lucide-react';
import { clsx } from 'clsx';

const tabs = (isFaq) => [
  { key: 'docs', label: isFaq ? 'FAQ' : '文档', icon: isFaq ? HelpCircle : FileText },
  { key: 'wiki', label: 'Wiki', icon: BookOpen },
  { key: 'graph', label: '图谱', icon: Share2 },
  { key: 'search', label: '搜索', icon: Search },
  { key: 'eval', label: '评估', icon: BarChart3 },
  { key: 'settings', label: '设置', icon: Settings }
];

const SOURCE_OPTIONS = [
  { value: '', label: '全部来源' },
  { value: 'file', label: '文件上传' },
  { value: 'url', label: '网页链接' },
  { value: 'manual', label: '手动创建' }
];

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'parsed', label: '已解析' },
  { value: 'parsing', label: '解析中' },
  { value: 'failed', label: '失败' },
  { value: 'pending', label: '待解析' }
];

function KBDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [activeTab, setActiveTab] = useState('docs');

  const { data: kbRes, loading: kbLoading, error: kbError, run: refreshKb, setData: setKbRes } = useAsync(() => KB.detail(id), [id]);
  const kb = kbRes?.data;

  // Documents: infinite scroll with accumulation
  const [docs, setDocs] = useState([]);
  const [docParams, setDocParams] = useState({ page: 1, page_size: 15, keyword: '', tag_ids: '', source: '', parse_status: '', start_time: '', end_time: '' });
  const [docsTotal, setDocsTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef();
  const fileInputRef = useRef(null);
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [tags, setTags] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState(null);
  const [batchParsing, setBatchParsing] = useState(false);
  const [batchStopping, setBatchStopping] = useState(false);
  const [batchDownloading, setBatchDownloading] = useState(false);
  const [notice, setNotice] = useState(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  const [deleting, setDeleting] = useState(false);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  const wikiEnabled = kb?.indexing_strategy?.wiki_enabled || kb?.wiki_config != null;
  const graphEnabled = kb?.indexing_strategy?.graph_enabled || false;
  const isFaq = kb?.type === 'faq';

  // 从聊天正文的 [[wiki 页面]] 链接跳进来：自动切到 wiki 标签，
  // 并把 slug 交给 WikiView 直接打开该页（wiki 未启用时保持原标签，不做无意义的跳转）
  const wikiSlugFromRoute = location.state?.wikiSlug || '';
  useEffect(() => {
    if (!wikiSlugFromRoute || !wikiEnabled) return;
    setActiveTab('wiki');
  }, [wikiSlugFromRoute, wikiEnabled]);

  // Fetch tags once
  useEffect(() => {
    if (!id || isFaq) return;
    Tag.list(id, { page_size: 100 }).then((res) => {
      const items = Array.isArray(res?.data) ? res.data : res?.data?.items || [];
      setTags(items);
    }).catch(() => setTags([]));
  }, [id, isFaq]);

  // Fetch documents
  const fetchDocs = useCallback(async (params, append = false) => {
    setListError(null);
    try {
      const res = await Knowledge.list(id, params);
      const items = Array.isArray(res?.data) ? res.data : res?.data?.items || res?.data?.list || res?.data?.pages || [];
      const total = res?.total || res?.data?.total || 0;
      setDocs((prev) => append ? [...prev, ...items] : items);
      setDocsTotal(total);
      setHasMore(items.length > 0 && (append ? docs.length + items.length : items.length) < total);
      return items;
    } catch (err) {
      setListError(err.message || '加载失败');
      return [];
    }
  }, [id, docs.length]);

  // Initial load + filter change
  useEffect(() => {
    if (activeTab !== 'docs') return;
    setDocs([]);
    setHasMore(true);
    setLoadingMore(true);
    fetchDocs({ ...docParams, page: 1 }, false).finally(() => setLoadingMore(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeTab, docParams.keyword, docParams.tag_ids, docParams.source, docParams.parse_status, docParams.start_time, docParams.end_time, docParams.page_size]);

  // 静默刷新：供解析轮询使用。
  // 拉取「与当前已展示条数等量」的第一页整体替换，既保留无限滚动已加载的条数，
  // 也不出现 loading 闪烁或滚动位置跳动；失败静默（保留旧数据，下一轮重试）。
  const silentRefresh = useCallback(async () => {
    try {
      const size = Math.min(100, Math.max(docParams.page_size, docs.length || docParams.page_size));
      const res = await Knowledge.list(id, { ...docParams, page: 1, page_size: size });
      const items = Array.isArray(res?.data) ? res.data : res?.data?.items || res?.data?.list || res?.data?.pages || [];
      setDocs(items);
      setDocsTotal(res?.total || res?.data?.total || 0);
      return items;
    } catch {
      return null;
    }
  }, [id, docParams, docs.length]);

  // 上传成功后本地插入该文档：列表立即出现并带出 parse_status，轮询随即接管，
  // 避免每上传一个文件就做一次全量刷新（批量上传时可省掉十几次请求）。
  const handleUploaded = useCallback((knowledge) => {
    if (!knowledge?.id) return;
    setDocs((prev) => (prev.some((d) => d.id === knowledge.id) ? prev : [knowledge, ...prev]));
    setDocsTotal((t) => t + 1);
  }, []);

  const {
    tasks: uploadTasks,
    enqueue: enqueueUploads,
    cancel: cancelUpload,
    retry: retryUpload,
    remove: removeUpload,
    clearFinished: clearFinishedUploads,
    summary: uploadSummary
  } = useUploadQueue({ kbId: id, onUploaded: handleUploaded });

  const parseStatusOf = useCallback(
    (knowledgeId) => docs.find((d) => d.id === knowledgeId)?.parse_status || null,
    [docs]
  );

  // 自动轮询：有 pending/processing/finalizing 文档时每 4s 刷新，
  // 全部停滞超 20 分钟降频到 15s，页面切后台暂停。
  const { polling, stalled } = useParsePolling({
    items: docs,
    onPoll: silentRefresh,
    enabled: activeTab === 'docs' && !isFaq
  });

  // Load more
  const loadMore = useCallback(() => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextPage = docParams.page + 1;
    fetchDocs({ ...docParams, page: nextPage }, true).finally(() => {
      setDocParams((p) => ({ ...p, page: nextPage }));
      setLoadingMore(false);
    });
  }, [loadingMore, hasMore, docParams, fetchDocs]);

  // Infinite scroll observer
  const lastItemRef = useCallback((node) => {
    if (loadingMore || !hasMore) return;
    if (observerRef.current) observerRef.current.disconnect();
    observerRef.current = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '120px' });
    if (node) observerRef.current.observe(node);
  }, [loadingMore, hasMore, loadMore]);

  const handleRefresh = async () => {
    setRefreshing(true);
    setSelectedDocs(new Set());
    setDocParams((p) => ({ ...p, page: 1 }));
    await fetchDocs({ ...docParams, page: 1 }, false);
    setRefreshing(false);
  };

  const handleFilterChange = (key, value) => {
    setDocParams((p) => ({ ...p, [key]: value, page: 1 }));
    setSelectedDocs(new Set());
  };

  // 支持多选：文件进入上传队列（串行上传，带真实进度，可取消/重试）。
  // 这里不再 await —— 队列在后台推进，用户可以继续操作列表、离开再回来。
  const handleFileChange = (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = ''; // 先清空，允许再次选择同一个文件
    if (files.length === 0) return;
    setUploadError(null);
    enqueueUploads(files);
  };

  const handleHybridSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      const res = await KB.hybridSearch(id, { query_text: searchQuery });
      setSearchResults(res.data || []);
    } catch (err) {
      setSearchError(err.message || '搜索失败');
    } finally {
      setSearching(false);
    }
  };

  const toggleDocSelection = (docId) => {
    setSelectedDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  };

  const handleBatchDelete = async () => {
    if (selectedDocs.size === 0) return;
    if (!window.confirm(`确定删除选中的 ${selectedDocs.size} 个文档？`)) return;
    setBatchDeleting(true);
    const ids = Array.from(selectedDocs);
    try {
      try {
        await Knowledge.batchRemove(id, ids);
      } catch (err) {
        // 老版本后端没有批量接口（404/405）时退化为逐条删除；
        // 其他错误（如 403 权限、409 冲突）不兜底，避免把真实原因掩盖成 N 次同样失败
        const msg = err?.message || '';
        const noBatchApi = /HTTP\s*(404|405)/.test(msg) || /not found|method not allowed/i.test(msg);
        if (!noBatchApi) throw err;
        const results = await Promise.allSettled(ids.map((docId) => Knowledge.remove(docId)));
        const failed = results.filter((r) => r.status === 'rejected').length;
        if (failed === ids.length) throw err;
        if (failed > 0) setNotice(`已删除 ${ids.length - failed} 个，${failed} 个删除失败`);
      }
      setSelectedDocs(new Set());
      setBatchMode(false);
      await handleRefresh();
    } catch (err) {
      alert(err.message || '批量删除失败');
    } finally {
      setBatchDeleting(false);
    }
  };

  // 批量「开始解析」：后端 /knowledge/batch-reparse 是异步任务队列（asynq），
  // 提交后立即返回，真正的进度靠解析状态轮询体现。
  const handleBatchReparse = async () => {
    if (selectedDocs.size === 0) return;
    setBatchParsing(true);
    setNotice(null);
    const ids = Array.from(selectedDocs);
    try {
      await Knowledge.batchReparse(id, ids);
      // 乐观更新为 pending，避免用户以为没反应；随后轮询会校正为真实状态
      setDocs((prev) => prev.map((d) => (ids.includes(d.id) ? { ...d, parse_status: 'pending' } : d)));
      setNotice(`已提交 ${ids.length} 个文档的重新解析任务`);
      setSelectedDocs(new Set());
      setBatchMode(false);
      silentRefresh();
    } catch (err) {
      alert(err.message || '批量重新解析失败');
    } finally {
      setBatchParsing(false);
    }
  };

  // 批量「停止解析」：后端没有批量取消接口，逐条调用 cancel-parse。
  // 用 allSettled 保证个别失败不影响其余；只对 in-flight 的文档发请求。
  const handleBatchCancelParse = async () => {
    const targets = docs
      .filter((d) => selectedDocs.has(d.id) && isInFlight(d.parse_status))
      .map((d) => d.id);
    if (targets.length === 0) {
      alert('选中的文档中没有正在解析的任务（仅 pending / 解析中 / 收尾中 可停止）');
      return;
    }
    if (!window.confirm(`停止选中的 ${targets.length} 个解析任务？已生成的分块与索引会保留，可随时重新解析。`)) return;
    setBatchStopping(true);
    setNotice(null);
    try {
      const results = await Promise.allSettled(targets.map((docId) => Knowledge.cancelParse(docId)));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = targets.length - ok;
      setDocs((prev) => prev.map((d) => (targets.includes(d.id) ? { ...d, parse_status: 'cancelled' } : d)));
      setNotice(`已停止 ${ok} 个解析任务${failed ? `，${failed} 个失败` : ''}`);
      setSelectedDocs(new Set());
      setBatchMode(false);
      silentRefresh();
    } catch (err) {
      alert(err.message || '停止解析失败');
    } finally {
      setBatchStopping(false);
    }
  };

  // 批量下载：后端把选中文档打包成 ZIP 返回（上限 200 个文件 / 512 MiB，
  // 无原文件的条目会被跳过）。超过上限先在前端拦下，避免传到一半才被 400 拒绝。
  const handleBatchDownload = async () => {
    const items = docs.filter((d) => selectedDocs.has(d.id));
    if (items.length === 0) return;
    if (items.length > 200) {
      alert(`单次最多下载 200 个文档，当前已选 ${items.length} 个，请分批下载。`);
      return;
    }
    const totalBytes = items.reduce((n, d) => n + (d.file_size || 0), 0);
    if (totalBytes > 300 * 1024 * 1024) {
      const ok = window.confirm(
        `已选 ${items.length} 个文档，原始文件合计约 ${formatBytes(totalBytes)}，打包下载可能较慢且占用较多流量。继续？`
      );
      if (!ok) return;
    }
    setBatchDownloading(true);
    setNotice(null);
    try {
      const stamp = new Date().toISOString().slice(0, 10);
      const fileName = `${safeFileName(kb?.name, '知识库')}_${items.length}份_${stamp}.zip`;
      const res = await saveFile({
        path: Knowledge.batchDownloadPath(id),
        method: 'POST',
        body: { ids: items.map((d) => d.id) },
        fileName
      });
      setNotice(res.via === 'native' ? `已保存到 ${res.message}` : `已下载 ${res.fileName}`);
      setSelectedDocs(new Set());
      setBatchMode(false);
    } catch (err) {
      alert('下载失败：' + (err.message || '未知错误'));
    } finally {
      setBatchDownloading(false);
    }
  };

  // 单文档快捷操作（列表行内）
  const handleStopDoc = async (doc) => {
    try {
      await Knowledge.cancelParse(doc.id);
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, parse_status: 'cancelled' } : d)));
    } catch (err) {
      alert(err.message || '停止解析失败');
    }
  };

  const handleReparseDoc = async (doc) => {
    try {
      await Knowledge.reparse(doc.id);
      setDocs((prev) => prev.map((d) => (d.id === doc.id ? { ...d, parse_status: 'pending' } : d)));
    } catch (err) {
      alert(err.message || '重新解析失败');
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('确定删除该知识库？知识库下所有知识将一并删除。')) return;
    setDeleting(true);
    try {
      await KB.remove(id);
      navigate('/kbs');
    } catch (err) {
      alert(err.message);
      setDeleting(false);
    }
  };

  const handleStartChat = async () => {
    try {
      // WeKnora 会话创建只接受 title/description，知识库在每次提问时动态传入
      const res = await Session.create({ title: kb?.name || '新会话' });
      navigate(`/session/${res.data.id}`, { state: { knowledge_base_id: id } });
    } catch (err) {
      alert('创建对话失败：' + (err.message || '未知错误'));
    }
  };

  const error = kbError || (activeTab === 'docs' && listError);

  // 选中项里可被「停止解析」的数量（只有 in-flight 状态能被取消）
  const stoppableCount = batchMode
    ? docs.filter((d) => selectedDocs.has(d.id) && isInFlight(d.parse_status)).length
    : 0;

  // 批量操作互斥：任一批量任务进行中，其余按钮全部禁用，避免并发操作互相踩状态
  const busy = batchParsing || batchDeleting || batchStopping || batchDownloading;

  return (
    <div className="p-4">
      {kbLoading && (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
        </div>
      )}

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {kb && (
        <>
          <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className={clsx('rounded-xl p-2', kb.type === 'faq' ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600')}>
                <Database className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-bold text-gray-900">{kb.name}</h2>
                <p className="text-xs text-gray-500">{kb.description || '暂无描述'}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                  <span className="rounded-lg bg-gray-100 px-2 py-1">{kb.knowledge_count || docsTotal || 0} 文档</span>
                  <span className="rounded-lg bg-gray-100 px-2 py-1">{kb.chunk_count || 0} 分块</span>
                  {wikiEnabled && <span className="rounded-lg bg-purple-100 px-2 py-1 text-purple-700">Wiki</span>}
                  {graphEnabled && <span className="rounded-lg bg-green-100 px-2 py-1 text-green-700">图谱</span>}
                </div>
              </div>
            </div>
            <button
              onClick={handleStartChat}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 text-sm font-medium text-white shadow-sm hover:from-blue-700 hover:to-indigo-700 active:scale-95 transition-transform"
            >
              <MessageSquare className="h-4 w-4" /> 开始对话
            </button>
          </div>

          <div className="mb-4 flex rounded-2xl bg-white p-1 shadow-sm">
            {tabs(isFaq).map((tab) => {
              const Icon = tab.icon;
              // Hide wiki/graph tabs if not enabled
              if (tab.key === 'wiki' && !wikiEnabled) return null;
              if (tab.key === 'graph' && !graphEnabled) return null;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-xs font-medium transition-colors',
                    activeTab === tab.key ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'
                  )}
                >
                  <Icon className="h-4 w-4" /> {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === 'docs' && isFaq && (
            <FAQView kbId={id} onRefresh={handleRefresh} />
          )}

          {activeTab === 'docs' && !isFaq && (
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={docParams.keyword}
                    onChange={(e) => handleFilterChange('keyword', e.target.value)}
                    placeholder="搜索文档…"
                    className="min-w-0 flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className={clsx('shrink-0 rounded-xl p-2 shadow-sm', showFilters ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600')}
                    title="筛选"
                  >
                    <Filter className="h-5 w-5" />
                  </button>
                  <button
                    onClick={handleRefresh}
                    disabled={refreshing}
                    className={clsx(
                      'relative shrink-0 rounded-xl p-2 shadow-sm disabled:opacity-50',
                      polling ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600'
                    )}
                    title={polling ? '正在自动刷新解析进度（点击立即刷新）' : '刷新'}
                  >
                    <RefreshCw className={clsx('h-5 w-5', (refreshing || polling) && 'animate-spin')} />
                  </button>
                </div>
                <div className="flex gap-2">
                  {!isFaq && (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-br from-brand-600 to-brand-400 px-3 py-2.5 text-sm font-medium text-white shadow-brand-lg hover:opacity-90 active:scale-[0.98]"
                    >
                      <Upload className="h-4 w-4" />
                      {uploadSummary.busy ? `上传中 ${uploadSummary.uploading + uploadSummary.queued}` : '上传文件'}
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={handleFileChange}
                      />
                    </button>
                  )}
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2.5 text-sm font-medium text-brand-600 shadow-card hover:bg-surface-subtle active:scale-[0.98]"
                  >
                    <Plus className="h-4 w-4" /> {isFaq ? '新建 FAQ' : '添加知识'}
                  </button>
                </div>
              </div>

              {uploadError && (
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
              )}

              {notice && (
                <div className="flex items-start gap-2 rounded-xl bg-emerald-50 p-3 text-xs text-emerald-700">
                  <span className="flex-1">{notice}</span>
                  <button type="button" onClick={() => setNotice(null)} className="shrink-0 text-emerald-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              <UploadTaskPanel
                tasks={uploadTasks}
                summary={uploadSummary}
                parseStatusOf={parseStatusOf}
                onCancel={cancelUpload}
                onRetry={retryUpload}
                onRemove={removeUpload}
                onClearFinished={clearFinishedUploads}
              />

              {showFilters && (
                <div className="rounded-2xl bg-white p-3 shadow-sm space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={docParams.source}
                      onChange={(e) => handleFilterChange('source', e.target.value)}
                      className="rounded-xl border border-gray-300 px-2 py-2 text-xs"
                    >
                      {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                    <select
                      value={docParams.parse_status}
                      onChange={(e) => handleFilterChange('parse_status', e.target.value)}
                      className="rounded-xl border border-gray-300 px-2 py-2 text-xs"
                    >
                      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  </div>
                  {tags.length > 0 && (
                    <select
                      value={docParams.tag_ids}
                      onChange={(e) => handleFilterChange('tag_ids', e.target.value)}
                      className="w-full rounded-xl border border-gray-300 px-2 py-2 text-xs"
                    >
                      <option value="">全部标签</option>
                      {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                    </select>
                  )}
                  <div className="flex gap-2">
                    <input
                      type="date"
                      value={docParams.start_time}
                      onChange={(e) => handleFilterChange('start_time', e.target.value)}
                      className="flex-1 rounded-xl border border-gray-300 px-2 py-2 text-xs"
                    />
                    <input
                      type="date"
                      value={docParams.end_time}
                      onChange={(e) => handleFilterChange('end_time', e.target.value)}
                      className="flex-1 rounded-xl border border-gray-300 px-2 py-2 text-xs"
                    />
                  </div>
                  <button
                    onClick={() => {
                      setDocParams({ page: 1, page_size: 15, keyword: '', tag_ids: '', source: '', parse_status: '', start_time: '', end_time: '' });
                      setSelectedDocs(new Set());
                    }}
                    className="w-full rounded-xl bg-gray-100 py-2 text-xs font-medium text-gray-700"
                  >
                    重置筛选
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  共 {docsTotal} 条，已加载 {docs.length} 条
                  {polling && (
                    <span className="ml-1.5 text-blue-600">{stalled ? '· 后台解析中（已降频）' : '· 解析进度自动刷新中'}</span>
                  )}
                </p>
                <button
                  onClick={() => {
                    setBatchMode(!batchMode);
                    setSelectedDocs(new Set());
                  }}
                  className={clsx('text-xs font-medium', batchMode ? 'text-blue-600' : 'text-gray-600')}
                >
                  {batchMode ? '完成' : '批量'}
                </button>
              </div>

              {batchMode && selectedDocs.size > 0 && (
                <div className="space-y-2 rounded-xl bg-blue-50 p-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-blue-700">
                      已选 {selectedDocs.size} 项
                      {stoppableCount > 0 && ` · ${stoppableCount} 项解析中`}
                    </span>
                  </div>
                  {/* 四个动作在手机上一行放不下，用 2×2 网格；每格高度一致，避免误触 */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={handleBatchReparse}
                      disabled={busy}
                      className="flex items-center justify-center gap-1 rounded-lg bg-brand-600 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {batchParsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                      重新解析
                    </button>
                    <button
                      onClick={handleBatchCancelParse}
                      disabled={busy || stoppableCount === 0}
                      className="flex items-center justify-center gap-1 rounded-lg bg-amber-500 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                      {batchStopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                      停止解析
                    </button>
                    <button
                      onClick={handleBatchDownload}
                      disabled={busy}
                      className="flex items-center justify-center gap-1 rounded-lg bg-surface-subtle px-2 py-1.5 text-xs font-medium text-gray-700 disabled:opacity-50"
                    >
                      {batchDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      下载 ZIP
                    </button>
                    <button
                      onClick={handleBatchDelete}
                      disabled={busy}
                      className="flex items-center justify-center gap-1 rounded-lg bg-red-600 px-2 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                    >
                      {batchDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      删除
                    </button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                {docs.map((doc) => {
                  const inFlight = isInFlight(doc.parse_status);
                  const meta = statusMeta(doc.parse_status);
                  return (
                    <div
                      key={doc.id}
                      onClick={() => batchMode ? toggleDocSelection(doc.id) : navigate(`/knowledge/${doc.id}`)}
                      className={clsx(
                        'flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm active:scale-95',
                        selectedDocs.has(doc.id) && 'bg-blue-50 ring-1 ring-blue-300'
                      )}
                    >
                      {batchMode && (
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleDocSelection(doc.id); }}
                          className="text-blue-600"
                        >
                          {selectedDocs.has(doc.id) ? <CheckSquare className="h-5 w-5" /> : <Square className="h-5 w-5" />}
                        </button>
                      )}
                      <div className="rounded-xl bg-gray-100 p-2 text-gray-600">
                        {doc.type === 'url' ? <Link className="h-5 w-5" /> : doc.type === 'manual' ? <PenLine className="h-5 w-5" /> : <File className="h-5 w-5" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-sm font-semibold text-gray-900">{doc.title || doc.file_name}</h4>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
                          <span className={clsx('inline-flex items-center gap-1 rounded-lg px-1.5 py-0.5 font-medium', meta.chip)}>
                            {inFlight && <Loader2 className="h-3 w-3 animate-spin" />}
                            {meta.label}
                          </span>
                          <span>{SOURCE_LABEL[doc.type] || doc.type}</span>
                          {doc.file_size ? <span>{formatBytes(doc.file_size)}</span> : null}
                          {doc.parse_status === 'finalizing' && doc.pending_subtasks_count > 0 && (
                            <span>子任务剩余 {doc.pending_subtasks_count}</span>
                          )}
                        </div>
                        {/* 失败原因直接摊在列表里：此前只能进详情页且详情页也不显示，
                            用户看到「失败」却无从判断是文件损坏、超限还是后端异常 */}
                        {doc.parse_status === 'failed' && doc.error_message && (
                          <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-red-600">
                            {doc.error_message}
                          </p>
                        )}
                      </div>
                      {/* 行内快捷操作：解析中可停止，失败/已取消可重新解析。
                          放在行右侧且 stopPropagation，避免误触进入详情页 */}
                      {!batchMode && inFlight && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleStopDoc(doc); }}
                          className="shrink-0 rounded-lg bg-amber-50 p-1.5 text-amber-600 active:scale-90"
                          title="停止解析"
                        >
                          <Ban className="h-4 w-4" />
                        </button>
                      )}
                      {!batchMode && (doc.parse_status === 'failed' || doc.parse_status === 'cancelled') && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleReparseDoc(doc); }}
                          className="shrink-0 rounded-lg bg-brand-50 p-1.5 text-brand-600 active:scale-90"
                          title="重新解析"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </button>
                      )}
                      <ChevronRight className="h-5 w-5 shrink-0 text-gray-400" />
                    </div>
                  );
                })}
              </div>

              {loadingMore && (
                <div className="py-3 text-center text-sm text-gray-500">
                  <Loader2 className="mx-auto mb-1 h-4 w-4 animate-spin" /> 加载中…
                </div>
              )}

              {!loadingMore && hasMore && docs.length > 0 && (
                <button
                  ref={lastItemRef}
                  onClick={loadMore}
                  className="w-full rounded-xl bg-white py-2.5 text-sm font-medium text-gray-700 shadow-sm"
                >
                  加载更多
                </button>
              )}

              {!hasMore && docs.length > 0 && (
                <div className="py-3 text-center text-xs text-gray-400">已加载全部 {docsTotal} 条文档</div>
              )}

              {!loadingMore && !listError && docs.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-400">暂无文档</div>
              )}
            </div>
          )}

          {activeTab === 'wiki' && <WikiView kbId={id} initialSlug={wikiSlugFromRoute} />}
          {activeTab === 'graph' && <GraphView kbId={id} />}

          {activeTab === 'search' && (
            <div className="space-y-3">
              <form onSubmit={handleHybridSearch} className="flex gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="输入问题进行混合搜索…"
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  type="submit"
                  disabled={searching}
                  className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>
              </form>

              {searchError && (
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{searchError}</div>
              )}

              {searchResults && searchResults.length === 0 && (
                <div className="py-8 text-center text-sm text-gray-500">未找到相关结果</div>
              )}

              <div className="space-y-3">
                {searchResults?.map((item, idx) => (
                  <div key={item.id} className="rounded-2xl bg-white p-4 shadow-sm">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-xs font-medium text-blue-600">#{idx + 1}</span>
                      <span className="text-xs text-gray-400">score {item.score?.toFixed(3)}</span>
                    </div>
                    <h4 className="mb-1 font-semibold text-gray-900">{item.knowledge_title}</h4>
                    <p className="text-sm text-gray-600 line-clamp-4">{item.content}</p>
                    <p className="mt-2 text-xs text-gray-400">{item.knowledge_filename}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'eval' && <KBEval kbId={id} kb={kb} />}

          {activeTab === 'settings' && (
            <div className="space-y-4">
              <KBSettings kb={kb} onUpdated={(updatedKb) => {
                if (updatedKb) setKbRes({ data: updatedKb });
                refreshKb();
              }} />
              {!isFaq && <TagManager kbId={id} />}
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-3 text-sm font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" /> {deleting ? '删除中' : '删除知识库'}
              </button>
            </div>
          )}

          {showCreateModal && (
            <CreateKnowledgeModal
              kbId={id}
              onClose={() => setShowCreateModal(false)}
              onCreated={handleRefresh}
            />
          )}
        </>
      )}
    </div>
  );
}

export default KBDetail;
