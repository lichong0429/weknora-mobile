import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { KB, Knowledge } from '../api/endpoints.js';
import KBSettings from './KBSettings.jsx';
import {
  FileText, Search, Settings, Upload, Loader2, AlertCircle,
  ChevronRight, Trash2, File, Link, PenLine, Database
} from 'lucide-react';
import { clsx } from 'clsx';

const tabs = [
  { key: 'docs', label: '文档', icon: FileText },
  { key: 'search', label: '搜索', icon: Search },
  { key: 'settings', label: '设置', icon: Settings }
];

function KBDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('docs');

  const { data: kbRes, loading: kbLoading, error: kbError, run: refreshKb } = useAsync(() => KB.detail(id), [id]);
  const kb = kbRes?.data;

  // Documents tab
  const [docParams, setDocParams] = useState({ page: 1, page_size: 20, keyword: '' });
  const { data: docsRes, loading: docsLoading, error: docsError, run: refreshDocs } = useAsync(
    () => Knowledge.list(id, docParams),
    [id, docParams]
  );
  const docs = docsRes?.data || [];
  const docsTotal = docsRes?.total || 0;

  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);

  // Search tab
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(null);

  // Settings tab
  const [deleting, setDeleting] = useState(false);

  const handleFileChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      await Knowledge.file(id, file);
      refreshDocs();
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

  const error = kbError || docsError;

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
                  <span className="rounded-lg bg-gray-100 px-2 py-1">{kb.knowledge_count || 0} 文档</span>
                  <span className="rounded-lg bg-gray-100 px-2 py-1">{kb.chunk_count || 0} 分块</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mb-4 flex rounded-2xl bg-white p-1 shadow-sm">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={clsx(
                    'flex flex-1 items-center justify-center gap-1 rounded-xl py-2 text-sm font-medium transition-colors',
                    activeTab === tab.key ? 'bg-blue-50 text-blue-600' : 'text-gray-500 hover:bg-gray-50'
                  )}
                >
                  <Icon className="h-4 w-4" /> {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === 'docs' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={docParams.keyword}
                  onChange={(e) => setDocParams({ ...docParams, keyword: e.target.value, page: 1 })}
                  placeholder="搜索文档…"
                  className="flex-1 rounded-xl border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <label className="flex cursor-pointer items-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700">
                  <Upload className="h-4 w-4" />
                  {uploading ? '上传中' : '上传'}
                  <input type="file" className="hidden" onChange={handleFileChange} />
                </label>
              </div>

              {uploadError && (
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{uploadError}</div>
              )}

              <div className="space-y-2">
                {docs.map((doc) => (
                  <div
                    key={doc.id}
                    onClick={() => navigate(`/knowledge/${doc.id}`)}
                    className="flex items-center gap-3 rounded-2xl bg-white p-3 shadow-sm active:scale-95"
                  >
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

              {docsTotal > docs.length && (
                <button
                  onClick={() => setDocParams({ ...docParams, page: docParams.page + 1 })}
                  className="w-full rounded-xl bg-white py-2.5 text-sm font-medium text-gray-700 shadow-sm"
                >
                  加载更多
                </button>
              )}
            </div>
          )}

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

          {activeTab === 'settings' && (
            <div className="space-y-4">
              <KBSettings kb={kb} onUpdated={refreshKb} />
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
        </>
      )}
    </div>
  );
}

export default KBDetail;
