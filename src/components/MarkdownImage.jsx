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

export function resolveUrl(url) {
  if (!url || typeof url !== 'string') return url;
  url = url.trim();
  if (/^https?:\/\//i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !url.startsWith('local://')) return url;

  const base = getMediaBaseUrl();
  if (url.startsWith('local://')) {
    return `${base}/api/v1/files?file_path=${encodeURIComponent(url)}`;
  }
  if (url.startsWith('/')) return `${base}${url}`;
  return `${base}/${url}`;
}

// 检测 src 是否需要走认证代理（local:// 等特殊 scheme）
export function isAuthProtectedSrc(src) {
  return typeof src === 'string' && /^(local|minio|cos|tos|s3|oss|ks3|obs):\/\//i.test(src.trim());
}

// 检测 src 是否指向 WeKnora 服务器（所有指向服务器的图片都需要 API Key 认证，
// <img> 标签无法带自定义 header，必须走 blob 代理）
export function isServerSrc(src) {
  if (!src || typeof src !== 'string') return false;
  const s = src.trim();
  // local:// 等特殊 scheme → 是
  if (isAuthProtectedSrc(s)) return true;
  // /files?file_path= 代理 URL → 是
  if (s.includes('/files?file_path=')) return true;
  // 以服务器 base URL 开头 → 是
  const base = getMediaBaseUrl();
  if (base && s.startsWith(base)) return true;
  return false;
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

  useEffect(() => {
    if (!src) {
      setFailed(true);
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

    const cacheKey = fetchParams.file_path || fetchPath;
    const cached = hydratedBlobCache.get(cacheKey);
    if (cached) {
      setResolvedSrc(cached);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    let createdBlobUrl = null;
    (async () => {
      try {
        const blob = await getBlob(fetchPath, fetchParams);
        if (cancelled) return;
        createdBlobUrl = URL.createObjectURL(blob);
        hydratedBlobCache.set(cacheKey, createdBlobUrl);
        setResolvedSrc(createdBlobUrl);
        setFailed(false);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
      // 注意：blob URL 缓存后复用，不 revoke
    };
  }, [src]);

  if (failed) {
    return (
      <span className="my-2 inline-block rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500">
        [图片加载失败]
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
