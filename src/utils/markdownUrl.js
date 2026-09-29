/**
 * react-markdown 的 URL 白名单。
 *
 * 为什么需要它：react-markdown v9 默认用 `defaultUrlTransform` 清洗地址，它只放行
 * http / https / mailto / tel 与相对路径，**其余协议一律置空**。实测：
 *
 *   defaultUrlTransform('local://10000/exports/a.png')  → ''      ← 整个 src 被清空
 *   defaultUrlTransform('resource://abc')               → ''
 *   defaultUrlTransform('storage://1/local://x.png')    → ''
 *
 * 而 WeKnora 的内部存储引用恰恰就是这些协议（PDF 抽取的图片、知识库内嵌图片、wiki 图片）。
 * 置空后 <img> 拿到的是空 src，图片组件连地址都收不到 —— 表现为「图片一直显示不出来」，
 * 且与文件是否存在无关。
 *
 * 安全边界：只放行自有协议，其余仍交给 defaultUrlTransform。
 * 不要整体关闭清洗（那会给模型输出 / 文档内容开 XSS 的口子）。
 */

// 后端 storageurl 支持的 provider 协议（与 MarkdownImage 的 STORAGE_REF_RE 保持一致）
const PROVIDER_SCHEME = 'resource|local|minio|cos|tos|s3|oss|obs|ks3';

const INTERNAL_URL_RE = new RegExp(
  `^(?:` +
    // 1) provider://…                                  默认形态（RESOURCE_URL_MODE=handle 时 resource://）
    //    注意：PROVIDER_SCHEME 本身是 `a|b|c` 形式的选择分支，必须用 (?:…) 包住，
    //    否则 `://` 只会粘在最后一个分支上（这里踩过，靠单测抓出来）。
    `(?:${PROVIDER_SCHEME})://\\S+` +
    // 2) storage://<backend-id>/provider://…          canonical 形态
    `|storage://[0-9A-Za-z_-]+/(?:${PROVIDER_SCHEME})://\\S+` +
  `)$`,
  'i'
);

// 应用自有协议：引用胶囊（cite:kb:n / cite:web:n）与 wiki 页面链接（wiki:…）
export const APP_URL_SCHEMES = ['cite:', 'wiki:'];

/** 是否为需要放行的应用自有协议 */
export function isAppSchemeUrl(url) {
  return typeof url === 'string' && APP_URL_SCHEMES.some((p) => url.startsWith(p));
}

/** 是否为 WeKnora 内部存储引用（需经鉴权代理取字节） */
export function isInternalStorageUrl(url) {
  return typeof url === 'string' && INTERNAL_URL_RE.test(url.trim());
}

/**
 * 传给 ReactMarkdown 的 urlTransform。
 * @param {string} url
 * @param {(url: string) => string} fallback 默认清洗函数（由调用方注入 defaultUrlTransform，
 *        便于单测时替换，避免测试依赖 react-markdown）
 */
export function markdownUrlTransform(url, fallback) {
  if (typeof url !== 'string' || url === '') return url;
  if (isAppSchemeUrl(url) || isInternalStorageUrl(url)) return url;
  return fallback ? fallback(url) : url;
}
