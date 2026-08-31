import { useState, useEffect } from 'react';
import { getBlob } from '../api/client.js';
import { getBaseUrl, getConfig } from '../config.js';

function getMediaBaseUrl() {
  const cfg = getConfig();
  if (cfg.baseUrl && /^https?:\/\//i.test(cfg.baseUrl)) {
    return cfg.baseUrl.replace(/\/$/, '');
  }
  const base = getBaseUrl().replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
  if (base && /^https?:\/\//i.test(base)) return base;
  if (cfg.baseUrl && typeof cfg.baseUrl === 'string') {
    const rel = cfg.baseUrl.replace(/\/$/, '');
    if (!rel.startsWith('/')) return rel;
  }
  return 'http://localhost:8080';
}

// WeKnora 内部存储引用的全部形态（对齐后端 internal/storageurl.Pattern）：
//   1. resource://<handle>                      —— 默认形态（RESOURCE_URL_MODE=handle）
//   2. storage://<backend-id>/<provider>://…     —— canonical 形态
//   3. local|minio|s3|cos|tos|oss|obs|ks3://…    —— 遗留/直连形态
// 三者都不能被浏览器直接加载，必须经鉴权的 /files 代理取字节。
const STORAGE_REF_RE = /^(?:resource:\/\/[0-9A-Za-z_-]+|(?:storage:\/\/[0-9A-Za-z_-]+\/)?(?:local|minio|s3|cos|tos|oss|obs|ks3):\/\/)/i;

export function resolveUrl(url) {
  if (!url || typeof url !== 'string') return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;

  const base = getMediaBaseUrl();
  // 任意内部存储引用 → 统一走 /files?file_path= 鉴权代理
  if (STORAGE_REF_RE.test(url)) {
    return `${base}/api/v1/files?file_path=${encodeURIComponent(url)}`;
  }
  // 其他自定义 scheme（data:、blob: 等）原样返回
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return url;
  if (url.startsWith('/')) return `${base}${url}`;
  return `${base}/${url}`;
}

// 检测 src 是否为 WeKnora 内部存储引用（需走鉴权代理）
export function isAuthProtectedSrc(src) {
  return typeof src === 'string' && STORAGE_REF_RE.test(src.trim());
}

// 检测 src 是否指向 WeKnora 服务器（所有指向服务器的图片都需要 API Key 认证，
// <img> 标签无法带自定义 header，必须走 blob 代理）
export function isServerSrc(src) {
  if (!src || typeof src !== 'string') return false;
  const s = src.trim();
  // 内部存储引用（resource://、storage://…、local://…）→ 是
  if (isAuthProtectedSrc(s)) return true;
  // /files?file_path= 代理 URL → 是
  if (s.includes('/files?file_path=')) return true;
  // /r/<token> 是后端为第三方渲染签发的免鉴权公开 URL，可直接用 <img> 加载
  if (/\/r\/[0-9A-Za-z_-]+\/?(\?|$)/.test(s)) return false;
  // 以服务器 base URL 开头 → 是
  const base = getMediaBaseUrl();
  if (base && s.startsWith(base)) return true;
  return false;
}

// 统一计算图片缓存键（组件内与失败重试共用，避免两处逻辑漂移）
export function imageCacheKey(src) {
  if (!src || typeof src !== 'string') return '';
  const s = src.trim();
  if (isAuthProtectedSrc(s)) return s;
  try {
    const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const u = new URL(s, origin);
    const fp = u.searchParams.get('file_path');
    return fp || u.pathname + u.search;
  } catch {
    return s;
  }
}

// 已 hydrated 的图片缓存（避免重复请求）
export const hydratedBlobCache = new Map();

// 1x1 透明 gif 占位骨架
export const PLACEHOLDER_BLOB = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 自定义 Markdown 图片组件：所有指向 WeKnora 服务器的图片通过 blob 代理显示，
// 因为 <img> 标签无法附加 X-API-Key 等自定义 header，服务器会返回 401。
export function MarkdownImage({ src, alt, title }) {
  const [resolvedSrc, setResolvedSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!src) {
      setFailed(true);
      setErrorMsg('图片地址为空');
      return undefined;
    }

    // 所有指向 WeKnora 服务器的图片都走 blob 代理（local://、/files、base URL 开头）
    const needProxy = isServerSrc(src);

    if (!needProxy) {
      // 外部图片（如外部 CDN）直接设置 URL
      setResolvedSrc(resolveUrl(src));
      setFailed(false);
      return undefined;
    }

    // 需要鉴权的图片：走 blob 代理
    // 1) 如果是 local:// 等特殊 scheme，直接用 src 作为 file_path
    // 2) 如果是已解析的 URL（/files?file_path=... 或 base URL 开头），需提取 file_path 或直接 fetch
    let fetchPath = src;
    let fetchParams = {};

    if (isAuthProtectedSrc(src)) {
      // local:// 等特殊 scheme → 通过 /files?file_path= 代理
      fetchPath = '/files';
      fetchParams = { file_path: src };
    } else {
      // 已解析的 URL → 提取 file_path 参数，或直接 fetch 完整路径
      try {
        const u = new URL(src, window.location.origin);
        const fp = u.searchParams.get('file_path');
        if (fp) {
          fetchPath = '/files';
          fetchParams = { file_path: fp };
        } else {
          // 直接 fetch 完整路径（如 /api/v1/...）
          fetchPath = u.pathname + u.search;
        }
      } catch {
        // URL 解析失败，尝试用原路径
        if (src.startsWith('/')) {
          fetchPath = src;
        } else {
          fetchPath = '/files';
          fetchParams = { file_path: src };
        }
      }
    }

    const cacheKey = imageCacheKey(src);
    const cached = hydratedBlobCache.get(cacheKey);
    if (cached) {
      setResolvedSrc(cached);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    (async () => {
      try {
        const blob = await getBlob(fetchPath, fetchParams);
        if (cancelled) return;
        // 空 body 也算失败：blob URL 会渲染成 0 字节的破图
        if (!blob || blob.size === 0) throw new Error('服务器返回空内容');
        const blobUrl = URL.createObjectURL(blob);
        hydratedBlobCache.set(cacheKey, blobUrl);
        setResolvedSrc(blobUrl);
        setFailed(false);
        setErrorMsg('');
      } catch (err) {
        if (cancelled) return;
        setFailed(true);
        setErrorMsg(err?.message || '未知错误');
      }
    })();
    return () => {
      cancelled = true;
      // 注意：blob URL 缓存后复用，不 revoke
    };
  }, [src, attempt]);

  if (failed) {
    const shortSrc = typeof src === 'string' && src.length > 40 ? `${src.slice(0, 40)}…` : src;
    return (
      <span className="my-2 flex flex-col gap-1 rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500">
        <span>[图片加载失败] {errorMsg}</span>
        {shortSrc && <span className="break-all text-[10px] text-gray-400">{shortSrc}</span>}
        <button
          type="button"
          onClick={() => {
            hydratedBlobCache.delete(imageCacheKey(src));
            setFailed(false);
            setErrorMsg('');
            setAttempt((n) => n + 1);
          }}
          className="self-start rounded bg-gray-200 px-2 py-0.5 text-[11px] text-gray-700 active:opacity-70"
        >
          重试
        </button>
      </span>
    );
  }
  if (!resolvedSrc) {
    return (
      <span
        className="my-2 inline-block animate-pulse rounded-lg bg-gray-100"
        style={{ minWidth: 120, minHeight: 80 }}
      />
    );
  }
  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      title={title}
      loading="lazy"
      className="my-2 max-w-full rounded-lg"
    />
  );
}
