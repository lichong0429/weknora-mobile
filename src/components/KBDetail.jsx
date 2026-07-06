import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { KB, Knowledge, Tag } from '../api/endpoints.js';
import KBSettings from './KBSettings.jsx';
import WikiView from './WikiView.jsx';
import GraphView from './GraphView.jsx';
import FAQView from './FAQView.jsx';
import TagManager from './TagManager.jsx';
import CreateKnowledgeModal from './CreateKnowledgeModal.jsx';
import KBEval from './KBEval.jsx';
import {
  FileText, Search, Settings, Upload, Loader2, AlertCircle,
  ChevronRight, Trash2, File, Link, PenLine, Database, RefreshCw,
  Filter, X, CheckSquare, Square, BookOpen, Share2,
  Tag as TagIcon, HelpCircle, Plus, BarChart3
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
  const [activeTab, setActiveTab] = useState('docs');

  const { data: kbRes, loading: kbLoading, error: kbError, run: refreshKb } = useAsync(() => KB.detail(id), [id]);
  const kb = kbRes?.data;

  // Documents: infinite scroll with accumulation
  const [docs, setDocs] = useState([]);
  const [docParams, setDocParams] = useState({ page: 1, page_size: 15, keyword: '', tag_ids: '', source: '', parse_status: '', start_time: '', end_time: '' });
  const [docsTotal, setDocsTotal] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const observerRef = useRef();
  const [selectedDocs, setSelectedDocs] = useState(new Set());
  const [batchMode, setBatchMode] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [tags, setTags] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [listError, setListError] = useState(null);

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

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await Knowledge.file(id, file);
      await handleRefresh();
    } catch (err) {
      setUploadError(err.message || '上传失败');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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
    try {
      await Knowledge.batchRemove?.(id, Array.from(selectedDocs)) ||
        Promise.all(Array.from(selectedDocs).map((docId) => Knowledge.remove(docId)));
      setSelectedDocs(new Set());
      setBatchMode(false);
      await handleRefresh();
    } catch (err) {
      alert(err.message || '批量删除失败');
    } finally {
      setBatchDeleting(false);
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

  const error = kbError || (activeTab === 'docs' && listError);

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
              <div className="flex gap-2">
                <input
                  type="text"
                  value={docParams.keyword}
                  onChange={(e) => handleFilterChange('keyword', e.target.value)}
                  placeholder="搜索文档…"
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={clsx('rounded-xl p-2 shadow-sm', showFilters ? 'bg-blue-50 text-blue-600' : 'bg-white text-gray-600')}
                  title="筛选"
                >
                  <Filter className="h-5 w-5" />
                </button>
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="rounded-xl bg-white p-2 text-gray-600 shadow-sm disabled:opacity-50"
                  title="刷新"
                >
                  <RefreshCw className={clsx('h-5 w-5', refreshing && 'animate-spin')} />
                </button>
                {!isFaq && (
                  <label className="flex cursor-pointer items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                    <Upload className="h-4 w-4" />
                    {uploading ? '…' : '上传'}
                    <input type="file" className="hidden" onChange={handleFileChange} />
                  </label>
                )}
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="flex items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                >
                  <Plus className="h-4 w-4" /> {isFaq ? 'FAQ' : '添加'}
                </button>
              </div>

              {uploadError && (
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
              )}

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
                <div className="flex items-center justify-between rounded-xl bg-blue-50 p-2">
                  <span className="text-xs text-blue-700">已选 {selectedDocs.size} 项</span>
                  <button
                    onClick={handleBatchDelete}
                    disabled={batchDeleting}
                    className="rounded-lg bg-red-600 px-2 py-1 text-xs text-white disabled:opacity-50"
                  >
                    {batchDeleting ? '删除中' : '删除'}
                  </button>
                </div>
              )}

              <div className="space-y-2">
                {docs.map((doc, idx) => (
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
                      <p className="text-xs text-gray-500">
                        {doc.type} · {doc.parse_status} · {doc.file_size ? `${(doc.file_size / 1024).toFixed(1)} KB` : ''}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-400" />
                  </div>
                ))}
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

          {activeTab === 'wiki' && <WikiView kbId={id} />}
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
              <KBSettings kb={kb} onUpdated={refreshKb} />
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
