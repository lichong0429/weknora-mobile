import { useEffect } from 'react';
import {
  isServerSrc,
  isAuthProtectedSrc,
  hydratedBlobCache,
  PLACEHOLDER_BLOB,
  fetchImageBlob,
  imageCacheKey,
  describeImageError
} from '../components/MarkdownImage.jsx';

/**
 * 扫描容器内所有 <img>，把指向 WeKnora 服务器的图片经 /files 鉴权代理转成 blob URL。
 *
 * 使用场景：用 dangerouslySetInnerHTML 渲染的 HTML 内容（知识条目预览、Wiki 正文）。
 * 这类内容里的 <img> 由浏览器直接创建，无法走 React 的 MarkdownImage 组件，
 * 而 <img> 又不能携带 X-API-Key，因此必须手动扫 DOM 换源。
 *
 * @param {React.RefObject<HTMLElement>} ref  内容容器
 * @param {string} content                    当前渲染的内容（用于在内容变化时重新 hydrate）
 * @param {boolean} enabled                   是否启用（非 HTML 路径无需处理）
 */
export function useImageHydrate(ref, content, enabled = true) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !content || !enabled) return undefined;

    const imgs = Array.from(root.querySelectorAll('img'));
    const targets = imgs.filter((img) => {
      const src = (img.getAttribute('src') || '').trim();
      if (!src) return false;
      // 已经是 blob/data 的跳过，避免重复处理
      if (/^(blob:|data:)/i.test(src)) return false;
      return isServerSrc(src);
    });
    if (targets.length === 0) return undefined;

    let cancelled = false;
    (async () => {
      await Promise.all(
        targets.map(async (img) => {
          const src = (img.getAttribute('src') || '').trim();

          // 确定取字节的路径与参数
          let fetchPath = '/files';
          let fetchParams = {};
          if (isAuthProtectedSrc(src)) {
            // resource://、storage://…、local://… 等内部引用 → file_path 直接用原串
            fetchParams = { file_path: src };
          } else {
            // 已解析的地址（/files?file_path=… 或 base URL 开头）
            try {
              const u = new URL(src, window.location.origin);
              const fp = u.searchParams.get('file_path');
              if (fp) {
                fetchParams = { file_path: fp };
              } else {
                fetchPath = u.pathname + u.search;
              }
            } catch {
              fetchPath = src;
            }
          }

          const cacheKey = imageCacheKey(src);

          // 先放占位骨架，避免布局跳动
          img.setAttribute('src', PLACEHOLDER_BLOB);

          const cached = hydratedBlobCache.get(cacheKey);
          if (cached) {
            if (!cancelled) img.src = cached;
            return;
          }
          try {
            // 走统一并发池，避免整页图片一次性打满连接
            const blob = await fetchImageBlob(fetchPath, fetchParams);
            if (cancelled) return;
            if (!blob || blob.size === 0) throw new Error('服务器返回空内容');
            const blobUrl = URL.createObjectURL(blob);
            hydratedBlobCache.set(cacheKey, blobUrl);
            img.src = blobUrl;
          } catch (err) {
            if (cancelled) return;
            // 失败不写缓存，下次进入可自动重试
            hydratedBlobCache.delete(cacheKey);
            img.replaceWith(
              Object.assign(document.createElement('span'), {
                className: 'my-2 inline-block rounded-lg bg-gray-100 px-3 py-2 text-xs text-gray-500',
                textContent: `[图片加载失败] ${describeImageError(err)}`
              })
            );
          }
        })
      );
    })();

    return () => {
      cancelled = true;
    };
  }, [ref, content, enabled]);
}
