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

// 检测 src 是否需要走认证代理（local:// 等 scheme）
export function isAuthProtectedSrc(src) {
  return typeof src === 'string' && /^(local|minio|cos|tos|s3|oss|ks3|obs):\/\//i.test(src.trim());
}

// 已 hydrated 的图片缓存（避免重复请求）
export const hydratedBlobCache = new Map();

// 1x1 透明 gif 占位骨架
export const PLACEHOLDER_BLOB = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

// 自定义 Markdown 图片组件：对 local:// 等需鉴权的 scheme 通过 /files?file_path= 代理 fetch blob，
// 转为 blob: URL 赋给 <img>（因为 <img> 无法附加 X-API-Key 等自定义 header）。
export function MarkdownImage({ src, alt, title }) {
  const [resolvedSrc, setResolvedSrc] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setFailed(true);
      return undefined;
    }

    if (!isAuthProtectedSrc(src)) {
      setResolvedSrc(resolveUrl(src));
      setFailed(false);
      return undefined;
    }

    const cached = hydratedBlobCache.get(src);
    if (cached) {
      setResolvedSrc(cached);
      setFailed(false);
      return undefined;
    }

    let cancelled = false;
    let createdBlobUrl = null;
    (async () => {
      try {
        const blob = await getBlob('/files', { file_path: src });
        if (cancelled) return;
        createdBlobUrl = URL.createObjectURL(blob);
        hydratedBlobCache.set(src, createdBlobUrl);
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
