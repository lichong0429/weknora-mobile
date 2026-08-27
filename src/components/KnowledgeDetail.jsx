import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Knowledge } from '../api/endpoints.js';
import { get, fetchPreview } from '../api/client.js';
import { getBaseUrl } from '../config.js';
import { Loader2, AlertCircle, Trash2, RefreshCw, XCircle, Save, ArrowLeft, ChevronDown, ChevronUp, FileText, Maximize2, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import KnowledgeChunks from './KnowledgeChunks.jsx';
import { MarkdownImage } from './MarkdownImage.jsx';
import { pushBackHandler } from '../backHandler.js';

// 预览默认展示上限（字符数）。此前 6000 对长文档仍需手动展开；提升到 30000 覆盖绝大多数文档，
// 超过时仍显示「展开全部」。fetchPreview 侧已把读取上限从 6064 字节提升到 2MB，二者配合保证完整显示。
const PREVIEW_MAX_LEN = 30000;
const PREVIEW_TIMEOUT_MS = 20000;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('请求超时')), ms))
  ]);
}

function KnowledgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, run } = useAsync(() => Knowledge.detail(id), [id]);
  const knowledge = data?.data;

  const [preview, setPreview] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);
  const [previewDebug, setPreviewDebug] = useState([]);
  const [showPreviewDebug, setShowPreviewDebug] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const closeFullscreen = () => setFullscreen(false);

  // 全屏预览：通过全局返回栈让原生返回键先关全屏（叠加在 Layout 的页面返回之上），
  // 关闭全屏后再按返回键才回上一页。
  useEffect(() => {
    if (!fullscreen) return undefined;
    return pushBackHandler(() => {
      setFullscreen(false);
      return true;
    });
  }, [fullscreen]);

  // 后端 /knowledge/{id}/preview 直接把原始文件流回（PDF/图片等二进制，或文本/HTML），
  // 这里存检测到的文件类型 + 原始文本/可内联的 blob URL（用于图片预览与下载）
  const [binaryKind, setBinaryKind] = useState(null);

  // 用 ref 持有最新的 binaryKind，避免 loadPreview 把它放进依赖导致重渲染死循环
  const binaryKindRef = useRef(binaryKind);
  binaryKindRef.current = binaryKind;
  // 用 ref 持有最新的 loadPreview，避免其在 useEffect 依赖数组里被“声明前引用”触发 TDZ 崩溃
  const loadPreviewRef = useRef(null);

  // 回收 object URL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (binaryKind?.blobUrl) URL.revokeObjectURL(binaryKind.blobUrl);
    };
  }, [binaryKind]);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (knowledge) {
      setTitle(knowledge.title || '');
      setDescription(knowledge.description || '');
      // 延迟加载 preview，避免页面切换时阻塞；通过 ref 调用，避免 loadPreview 进入依赖触发 TDZ
      const timer = setTimeout(() => loadPreviewRef.current?.(), 50);
      return () => clearTimeout(timer);
    }
  }, [knowledge]);

  const loadPreview = useCallback(async () => {
    setPreviewLoading(true);
    setPreviewError(null);
    setPreviewDebug([]);
    setExpanded(false);
    if (binaryKindRef.current?.blobUrl) URL.revokeObjectURL(binaryKindRef.current.blobUrl);
    setBinaryKind(null);
    const attempts = [];

    try {
      // 1. 优先从 knowledge 详情字段提取（避免额外请求，很多后端已经把文本放在 detail 里）
      const detailText = extractPreviewText(knowledge);
      if (detailText && detailText.trim().length > 0) {
        attempts.push({ source: 'knowledge.detail 字段', ok: true, status: 'success' });
        setPreview(detailText);
        setPreviewDebug(attempts);
        setPreviewLoading(false);
        return;
      }

      // 2. 流式拉取 preview 接口：文本类只读头部就中断下载（避免大文件整体下载导致超时/OOM），
      //    图片/二进制读完整 blob 用于内联渲染或下载。先看 mime 判断是否为二进制。
      try {
        const r = await withTimeout(
          fetchPreview(`/knowledge/${id}/preview`),
          PREVIEW_TIMEOUT_MS
        );
        const mime = (r.contentType || '').toLowerCase();
        const isImage = r.isImage;

        if (r.isBinary) {
          attempts.push({ source: 'GET /knowledge/{id}/preview (blob)', ok: true, status: mime });
          const blobUrl = URL.createObjectURL(r.blob);
          setBinaryKind({
            kind: isImage ? 'image' : mimeToKind(mime, r.size),
            isImage,
            blobUrl,
            contentType: mime,
            size: r.size
          });
          setPreviewDebug(attempts);
          setPreviewLoading(false);
          return;
        }

        // 文本类：只读到的头部内容，再判 magic bytes（防 mime 撒谎）
        // 后端 preview 接口可能直接返回正文，也可能返回 JSON（如 { code, data:{ content } }），
        // 统一用 extractTextFromAny 提取其中的正文串。
        const text = extractTextFromAny(r.text || '');
        if (text && text.trim().length > 0) {
          const kind = detectBinaryKind(text);
          if (kind) {
            attempts.push({ source: 'GET /knowledge/{id}/preview (blob→text magic)', ok: true, status: kind });
            const blobUrl = URL.createObjectURL(r.blob || new Blob([text]));
            setBinaryKind({ kind, blobUrl, rawText: text, contentType: mime, size: r.size });
            setPreviewDebug(attempts);
            setPreviewLoading(false);
            return;
          }
          attempts.push({ source: 'GET /knowledge/{id}/preview (text)', ok: true, status: 'success' });
          // 完整保存预览数据（fetchPreview 已读满 2MB）；PREVIEW_MAX_LEN 仅控制默认显示长度与「展开全部」按钮
          setPreview(text);
          setPreviewDebug(attempts);
          setPreviewLoading(false);
          return;
        }
        // 文本为空：继续兜底，不提前 return
      } catch (err) {
        attempts.push({ source: 'GET /knowledge/{id}/preview (blob)', ok: false, error: err.message });
      }

      // 3. 知识详情接口兜底（部分文档正文就在详情里）
      try {
        const res = await withTimeout(get(`/knowledge/${id}`), PREVIEW_TIMEOUT_MS);
        const text = extractPreviewText(res?.data || res);
        if (text && text.trim().length > 0) {
          attempts.push({ source: 'GET /knowledge/{id}', ok: true, status: 'success' });
          setPreview(text);
          setPreviewDebug(attempts);
          setPreviewLoading(false);
          return;
        }
      } catch (err) {
        attempts.push({ source: 'GET /knowledge/{id}', ok: false, error: err.message });
      }

      setPreviewDebug(attempts);
      setPreviewError('该文档暂无预览内容，可能尚未解析完成，或后端未提供预览接口。');
    } catch (err) {
      setPreviewError(err.message || '加载预览失败');
    } finally {
      setPreviewLoading(false);
    }
  }, [id, knowledge]);

  // 每次渲染后把最新 loadPreview 同步到 ref（useEffect 通过 ref 调用，拿到的是最新闭包）
  loadPreviewRef.current = loadPreview;

  const handleSave = async () => {
    setSaving(true);
    try {
      if (knowledge.type === 'manual') {
        await Knowledge.updateManual(id, { title, content, description });
      } else {
        await Knowledge.update(id, { title, description });
      }
      run();
      setEditing(false);
    } catch (err) {
      alert(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm('确定删除该知识？')) return;
    try {
      await Knowledge.remove(id);
      navigate('/kbs');
    } catch (err) {
      alert(err.message);
    }
  };

  const handleReparse = async () => {
    try {
      await Knowledge.reparse(id);
      run();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleCancel = async () => {
    try {
      await Knowledge.cancelParse(id);
      run();
    } catch (err) {
      alert(err.message);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</div>
      </div>
    );
  }

  if (!knowledge) {
    return (
      <div className="p-4">
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
          未找到该知识条目，或后端未返回有效数据。
          <button onClick={() => navigate(-1)} className="ml-2 text-xs text-blue-600">返回</button>
        </div>
      </div>
    );
  }

  const isHtml = isHtmlContent(preview);
  const displayPreview = expanded ? preview : preview.slice(0, PREVIEW_MAX_LEN);
  const isTruncated = preview.length > PREVIEW_MAX_LEN;

  return (
    <div className="p-4">
      <div className="mb-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="h-4 w-4" /> 返回
          </button>
          <div className="flex gap-2">
            <button onClick={() => setEditing(!editing)} className="rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700">
              {editing ? '取消' : '编辑'}
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">标题</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700">描述</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            {knowledge.type === 'manual' && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-700">正文</label>
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={8}
                  className="w-full rounded-xl border border-gray-300 px-3 py-2 text-sm font-mono"
                  placeholder={preview ? '首次编辑会覆盖原内容，建议先预览' : ''}
                />
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {saving ? '保存中' : '保存'}
            </button>
          </div>
        ) : (
          <>
            <h2 className="mb-1 text-lg font-bold text-gray-900">{knowledge.title || knowledge.file_name}</h2>
            <p className="text-sm text-gray-500">{knowledge.description || '暂无描述'}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{knowledge.type}</span>
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{knowledge.parse_status}</span>
              <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">{knowledge.enable_status}</span>
              {knowledge.file_size && (
                <span className="rounded-lg bg-gray-100 px-2 py-1 text-xs text-gray-600">
                  {(knowledge.file_size / 1024).toFixed(1)} KB
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {!editing && (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2">
            <button
              onClick={handleReparse}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 text-xs font-medium text-gray-700 shadow-sm"
            >
              <RefreshCw className="h-4 w-4" /> 重新解析
            </button>
            <button
              onClick={handleCancel}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 text-xs font-medium text-gray-700 shadow-sm"
            >
              <XCircle className="h-4 w-4" /> 取消解析
            </button>
            <button
              onClick={handleDelete}
              className="flex flex-col items-center gap-1 rounded-2xl bg-white py-3 text-xs font-medium text-red-600 shadow-sm"
            >
              <Trash2 className="h-4 w-4" /> 删除
            </button>
          </div>

          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                <h3 className="font-semibold text-gray-900">预览</h3>
              </div>
              <div className="flex items-center gap-2">
                {preview.length > 0 && (
                  <span className="text-xs text-gray-400">{preview.length} 字符</span>
                )}
                <button onClick={loadPreview} className="text-xs text-blue-600">刷新</button>
                {preview && (
                  <button
                    onClick={() => setFullscreen(true)}
                    className="flex items-center gap-1 rounded-lg bg-gray-100 px-2 py-1 text-xs font-medium text-gray-700 active:scale-95"
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> 全屏
                  </button>
                )}
              </div>
            </div>
            {previewLoading ? (
              <div className="py-8 text-center text-sm text-gray-500">
                <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" /> 加载预览…
              </div>
            ) : previewError ? (
              <>
                <div className="rounded-xl bg-red-50 p-3 text-sm text-red-700">
                  <p>{previewError}</p>
                  <button
                    onClick={() => setShowPreviewDebug((s) => !s)}
                    className="mt-2 text-xs text-gray-600"
                  >
                    {showPreviewDebug ? '隐藏调试' : '显示调试'}
                  </button>
                  {showPreviewDebug && (
                    <div className="mt-2 rounded-lg bg-gray-900 p-2 text-xs text-gray-100">
                      {previewDebug.map((a, i) => (
                        <div key={i} className={a.ok ? 'text-green-400' : 'text-red-400'}>
                          {a.ok ? '✓' : '✗'} {a.source}: {a.ok ? a.status : a.error}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <p className="mb-2 text-xs font-medium text-gray-500">尝试以分块内容展示：</p>
                  <KnowledgeChunks knowledgeId={id} kbId={knowledge.kb_id} />
                </div>
              </>
            ) : binaryKind ? (
              <div className="space-y-3">
                {binaryKind.isImage ? (
                  <img
                    src={binaryKind.blobUrl}
                    alt="preview"
                    onClick={() => setFullscreen(true)}
                    className="max-h-80 w-full cursor-pointer rounded-xl object-contain bg-gray-50 active:opacity-80"
                  />
                ) : (
                  <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-medium">该文件是 {binaryKind.kind} 二进制格式</p>
                    <p className="mt-1 text-xs">
                      移动端不支持内嵌预览，请下载到本地查看。
                      {binaryKind.size != null && (
                        <span className="ml-1 text-amber-700">（{formatBytes(binaryKind.size)}）</span>
                      )}
                    </p>
                  </div>
                )}
                <div className="flex flex-col gap-2 sm:flex-row">
                  {!binaryKind.isImage && (
                    <a
                      href={getPreviewFileUrl(id, binaryKind.kind)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-blue-600 px-3 py-2 text-xs font-medium text-white active:scale-95"
                    >
                      在浏览器中打开
                    </a>
                  )}
                  <a
                    href={binaryKind.blobUrl}
                    download
                    className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-gray-100 px-3 py-2 text-xs font-medium text-gray-700 active:scale-95"
                  >
                    下载文件
                  </a>
                </div>
                {showPreviewDebug && binaryKind.rawText && (
                  <div className="rounded-lg bg-gray-900 p-2 text-xs text-gray-100 break-all">
                    <p className="mb-1 text-gray-400">原始响应（前 500 字符）：</p>
                    <pre className="whitespace-pre-wrap">{binaryKind.rawText.slice(0, 500)}</pre>
                  </div>
                )}
              </div>
            ) : preview ? (
              <div className="space-y-3">
                <div
                  onClick={() => setFullscreen(true)}
                  className="cursor-pointer rounded-xl border border-gray-100 p-3 transition-colors hover:bg-gray-50 active:bg-gray-100"
                >
                  {isHtml ? (
                    <div
                      className="md-body max-h-96 overflow-y-auto"
                      dangerouslySetInnerHTML={{ __html: cleanHtml(displayPreview) }}
                    />
                  ) : (
                    <div className="md-body max-h-96 overflow-y-auto">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ img: MarkdownImage }}>{displayPreview}</ReactMarkdown>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between">
                  {isTruncated && (
                    <button
                      onClick={() => setExpanded(!expanded)}
                      className="flex items-center gap-1 rounded-xl bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600"
                    >
                      {expanded ? (
                        <><ChevronUp className="h-4 w-4" /> 收起</>
                      ) : (
                        <><ChevronDown className="h-4 w-4" /> 展开全部 ({preview.length} 字符)</>
                      )}
                    </button>
                  )}
                  <button
                    onClick={() => setFullscreen(true)}
                    className="ml-auto flex items-center gap-1 rounded-xl bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-600 active:scale-95"
                  >
                    <Maximize2 className="h-3.5 w-3.5" /> 全屏阅读
                  </button>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center">
                <FileText className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                <p className="text-sm text-gray-500">暂无预览内容</p>
                <p className="mt-1 text-xs text-gray-400">该文档可能尚未解析完成，或后端未提供预览接口</p>
                <div className="mt-4 text-left">
                  <KnowledgeChunks knowledgeId={id} kbId={knowledge.kb_id} />
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* 全屏阅读 Modal：淡入上滑动画 + 安全区 + 常驻关闭按钮 + 系统返回键可退出 */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-surface-soft animate-[fsIn_0.28s_ease-out]">
          <div className="safe-top shrink-0 border-b border-line bg-white/95 backdrop-blur">
            <div className="flex items-center justify-between px-4 py-3">
              <h3 className="min-w-0 flex-1 truncate pr-3 text-[15px] font-semibold text-ink">
                {knowledge.title || knowledge.file_name}
              </h3>
              <button
                onClick={closeFullscreen}
                aria-label="关闭预览"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-subtle text-ink-muted transition-colors hover:bg-surface-soft hover:text-ink active:scale-90"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto px-5 pb-safe pt-5">
            {binaryKind?.isImage ? (
              <img src={binaryKind.blobUrl} alt="preview" className="mx-auto max-h-full w-auto rounded-xl object-contain" />
            ) : isHtml ? (
              <div
                className="md-body"
                dangerouslySetInnerHTML={{ __html: cleanHtml(preview) }}
              />
            ) : (
              <div className="md-body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={{ img: MarkdownImage }}>{preview}</ReactMarkdown>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function extractPreviewText(data) {
  if (!data) return '';
  if (typeof data === 'string') return data.trim();
  // 兼容后端可能的信封嵌套：{ data: {...} } 或 { result: {...} }
  const inner = data.data && typeof data.data === 'object' ? data.data
    : data.result && typeof data.result === 'object' ? data.result
    : data;
  const candidates = [
    inner?.content, inner?.text, inner?.preview, inner?.body, inner?.markdown,
    inner?.html, inner?.answer, inner?.document, inner?.summary, inner?.parsed_content,
    inner?.chunk_text, inner?.content_text,
    data?.content, data?.text, data?.preview, data?.body, data?.markdown,
    data?.html, data?.answer, data?.document, data?.summary, data?.parsed_content
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  // 某些后端把正文放在 data.data.content 之类的二级字段
  if (data.data && typeof data.data === 'object') {
    const d2 = data.data;
    const c2 = [d2.content, d2.text, d2.preview, d2.body, d2.markdown, d2.html, d2.document, d2.summary];
    for (const c of c2) {
      if (typeof c === 'string' && c.trim().length > 0) return c;
    }
  }
  return '';
}

// 后端 preview / detail 接口可能直接返回正文文本，也可能返回 JSON（如 { code, data:{ content } }）。
// 若是 JSON，尝试提取其中的正文串；否则原样返回。
function extractTextFromAny(raw) {
  if (!raw || !raw.trim()) return '';
  const t = raw.trim();
  if (t[0] === '{' || t[0] === '[') {
    try {
      const obj = JSON.parse(t);
      const extracted = extractPreviewText(obj);
      if (extracted) return extracted;
    } catch {
      // 不是合法 JSON，按纯文本处理
    }
  }
  return t;
}

function isHtmlContent(text) {
  if (typeof text !== 'string') return false;
  const tagPattern = /<[^\s<>/][^<>]*>/i;
  const hasHtmlTags = tagPattern.test(text);
  const hasMarkdown = /^#{1,6}\s|^\s*[-*+]\s|^\s*\d+\.\s|^\[.*\]\(.*\)|^\*\*.*\*\*|^__.*__|^`.*`|^```/m.test(text);
  // 如果包含明显 HTML 标签且不像 Markdown，按 HTML 渲染
  return hasHtmlTags && !hasMarkdown;
}

// 检测后端 preview 接口返回的 body 是不是二进制文件（PDF/图片等）。
// 后端 /knowledge/{id}/preview 对 PDF/图片是直接流回原文件的 Content-Type 形式，
// 但移动端用 blob 拿到的文本会包含 magic bytes 或不可打印字符。
function detectBinaryKind(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const head = text.slice(0, 16);
  if (head.startsWith('%PDF')) return 'PDF';
  if (head.startsWith('\x89PNG')) return 'PNG';
  if (head.startsWith('\xff\xd8\xff')) return 'JPEG';
  if (head.startsWith('GIF8')) return 'GIF';
  if (head.startsWith('PK\x03\x04')) return 'ZIP/Office';
  if (/[\x00-\x08\x0e-\x1f]/.test(text.slice(0, 200))) return '二进制';
  return null;
}

// 把 mime 映射成展示用的类型标签。已知 mime 直接映射，未知兜底显示"二进制"。
function mimeToKind(mime, size) {
  if (!mime) return '二进制';
  if (mime.includes('pdf')) return 'PDF';
  if (mime.startsWith('image/png')) return 'PNG';
  if (mime.startsWith('image/jpeg') || mime.startsWith('image/jpg')) return 'JPEG';
  if (mime.startsWith('image/gif')) return 'GIF';
  if (mime.startsWith('image/webp')) return 'WebP';
  if (mime.startsWith('image/svg')) return 'SVG';
  if (mime.includes('word') || mime.includes('officedocument.wordprocessing')) return 'Word';
  if (mime.includes('excel') || mime.includes('officedocument.spreadsheet')) return 'Excel';
  if (mime.includes('powerpoint') || mime.includes('officedocument.presentation')) return 'PowerPoint';
  if (mime.includes('zip') || mime.includes('epub') || mime.includes('officedocument')) return 'ZIP/Office';
  if (mime.startsWith('audio/')) return '音频';
  if (mime.startsWith('video/')) return '视频';
  return '二进制';
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// 拼一个能在浏览器里直接打开的预览 URL（带 X-API-Key）
function getPreviewFileUrl(id, kind) {
  // 用 getBaseUrl() 拿带 API key 头的 base，再用 URLSearchParams 把 key 拼上去
  // （浏览器打开外链时拿不到 X-API-Key 头，所以用 query string 形式；后端某些版本会接受）
  // 退而求其次：返回纯路径，让用户至少能复制到浏览器手动加 header
  return `${getBaseUrl().replace(/\/api\/v1\/?$/, '')}/api/v1/knowledge/${id}/preview`;
}

function cleanHtml(html) {
  if (!html || typeof html !== 'string') return '';
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, '')
    .replace(/on\w+\s*=/gi, 'data-disabled=')
    .replace(/javascript:/gi, 'disabled:');
}

export default KnowledgeDetail;
