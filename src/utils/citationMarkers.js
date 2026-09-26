// 回答正文里的引用标记处理（与网页端 frontend/src/utils/citationMarkdown.ts 行为对齐）。
//
// 背景：WeKnora 在回答正文里插入两类引用标记：
//     <kb  doc="xxx.pdf" chunk_id="…" kb_id="…" />      知识库文档引用
//     <web url="https://…" title="…" />                 联网搜索引用（Agent 模式常见）
// 网页端把它们渲染成可点的行内胶囊：文档引用显示"文档名"，点击后**按 chunk id 现取原文**
// 弹层展示；联网引用显示"域名"，点击在新标签打开。
//
// 手机端此前把整段正文直接交给 Markdown 渲染，`<kb>` / `<web>` 属未知标签，
// 浏览器当作无意义元素忽略 —— 引用标记**既不显示也点不开**。
//
// 这里做三件事：
//   1. 把标记换成 Markdown 链接 `[n](cite:kb:n)` / `[n](cite:web:n)`，渲染层拦截后画成胶囊；
//   2. 隐藏流式过程中尚未接收完整的半个标签，否则正文会漏出 `<kb doc="1-s2.0…` 这种乱码；
//   3. 把模型可能给出的非 UUID 引用（FAQ-1 / DOC-2 / 纯序号）映射回真实 chunk id。
//
// 为什么不用 `#cite:n` 锚点形式：App 用 HashRouter，改 hash 会被当成路由跳转并弹回首页。

export const CITE_SCHEME = 'cite:';
export const CITE_KB_PREFIX = `${CITE_SCHEME}kb:`;
export const CITE_WEB_PREFIX = `${CITE_SCHEME}web:`;
// wiki 页面链接：答案里出现 [[slug]] / [[slug|显示名]]，网页端渲染成可点的 wiki 链接。
// 这里沿用 App 既有的 wiki: 协议（WikiView 内部识别 wiki: 并打开对应 wiki 页面）。
export const WIKI_PREFIX = 'wiki:';

// [[slug]] 或 [[slug|显示名]]
const WIKI_LINK_RE = /\[\[([^\]\n]+)\]\]/g;

const KB_TAG_RE = /<kb\b([^>]*?)\s*\/?>/gi;
const WEB_TAG_RE = /<web\b([^>]*?)\s*\/?>/gi;
const ANY_CITATION_TAG_RE = /<(?:kb|web)\b[^>]*?\s*\/?>/gi;
// 一次扫过两种标签：必须按**正文出现顺序**编号。
// 早先按标签类型分两批替换，导致混排时编号与阅读顺序不一致（先出现的反而编号靠后）。
const MIXED_TAG_RE = /<(kb|web)\b([^>]*?)\s*\/?>/gi;
const ATTR_RE = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseAttrs(raw) {
  const out = {};
  const re = new RegExp(ATTR_RE.source, 'g');
  let m;
  while ((m = re.exec(raw || '')) !== null) {
    out[m[1]] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return out;
}

/**
 * 流式过程中标记可能只收到一半（如 `<kb doc="1-s2.0`）。
 * 若原样交给 Markdown，会先渲染成普通文本，等标签补齐才消失 —— 肉眼可见的乱码。
 * 这里把末尾未闭合的引用标签掐掉，等收全了再走正常流程。
 */
export function stripIncompleteCitationTag(content) {
  const src = String(content || '');
  let out = src;
  const start = out.lastIndexOf('<');
  if (start >= 0) {
    const tail = out.slice(start);
    if (!tail.includes('>')) {
      const isCitationPrefix = tail === '<'
        || /^<k(?:b(?:\s[\s\S]*)?)?$/i.test(tail)
        || /^<w(?:e(?:b(?:\s[\s\S]*)?)?)?$/i.test(tail);
      if (isCitationPrefix) out = out.slice(0, start);
    }
  }
  // [[wiki 链接同理：只收到 "[[" 或 "[[conce" 时先藏起来，等收全再渲染
  const wikiStart = out.lastIndexOf('[[');
  if (wikiStart >= 0 && !out.slice(wikiStart).includes(']]')) {
    out = out.slice(0, wikiStart);
  }
  return out;
}

function normalizeTitle(t) {
  return String(t || '').trim().toLowerCase();
}

function titlesMatch(a, b) {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * 把模型给出的 chunk 标识映射回真实 chunk id。
 * 模型有时不写 UUID，而写 `FAQ-1`、`DOC-2` 或纯序号（指引用列表里的第几项），
 * 网页端也是这么还原的 —— 不做这一步，这些引用在手机端会取不到内容。
 */
export function resolveCitationChunkId(rawChunkId, { doc, kbId } = {}, refs) {
  const raw = String(rawChunkId || '').trim();
  if (!raw || UUID_RE.test(raw)) return raw;

  const list = (Array.isArray(refs) ? refs : []).filter((r) => r && r.chunk_type !== 'web_search');
  if (!list.length) return raw;

  const d = String(doc || '').trim();
  const k = String(kbId || '').trim();

  if (d) {
    const byDoc = list.find((r) => titlesMatch(d, r.knowledge_title) || titlesMatch(d, r.knowledge_filename));
    if (byDoc?.id) return byDoc.id;
  }

  const faq = /^FAQ-(\d+)$/i.exec(raw);
  if (faq) {
    const hit = list.filter((r) => r.chunk_type === 'faq')[Number(faq[1]) - 1];
    if (hit?.id) return hit.id;
  }

  const docSeq = /^DOC-(\d+)$/i.exec(raw);
  if (docSeq) {
    const hit = list.filter((r) => r.chunk_type !== 'faq')[Number(docSeq[1]) - 1];
    if (hit?.id) return hit.id;
  }

  const num = Number.parseInt(raw, 10);
  if (!Number.isNaN(num) && String(num) === raw) {
    const byPos = list[num - 1];
    if (byPos?.id) return byPos.id;
    const byIndex = list.find((r) => r.chunk_index === num || r.chunk_index === num - 1);
    if (byIndex?.id) return byIndex.id;
  }

  if (k) {
    const scoped = list.filter((r) => r.knowledge_base_id === k);
    if (d) {
      const byDoc = scoped.find((r) => titlesMatch(d, r.knowledge_title) || titlesMatch(d, r.knowledge_filename));
      if (byDoc?.id) return byDoc.id;
    }
    if (scoped.length === 1 && scoped[0].id) return scoped[0].id;
  }

  return raw;
}

// 胶囊上显示的文档名：两端保留、中间省略（与网页端一致，13 字符）
export function truncateMiddle(text, maxLength = 13) {
  const s = String(text || '');
  if (s.length <= maxLength) return s;
  const half = Math.floor((maxLength - 3) / 2);
  const start = s.slice(0, half + ((maxLength - 3) % 2));
  const end = s.slice(-half);
  return `${start}...${end}`;
}

export function domainOf(url) {
  try {
    const host = new URL(url).hostname || '';
    const parts = host.split('.');
    return parts.length >= 2 ? parts.slice(-2).join('.') : (host || url);
  } catch {
    return url;
  }
}

/**
 * 抽出正文里的引用标记，替换成渲染层可识别的链接。
 * @param {string} content 助手回答正文（可含流式未收尾内容）
 * @param {Array} references 本轮返回的 knowledge_references（用于还原非 UUID 引用）
 * @returns {{ text: string, markers: Array }}
 *   markers[i] = { kind:'kb'|'web', number, key, doc, chunkId, kbId, title, url }
 */
export function extractCitations(content, references) {
  const order = new Map();
  const markers = [];
  let next = 0;

  const push = (key, marker) => {
    if (!order.has(key)) {
      next += 1;
      order.set(key, next);
      markers.push({ ...marker, number: next, key });
    }
    return order.get(key);
  };

  let text = String(content || '');

  // 单次遍历：文档引用与联网引用混排时，编号仍与正文顺序一致
  text = text.replace(MIXED_TAG_RE, (_full, tag, rawAttrs) => {
    const attrs = parseAttrs(rawAttrs);

    if (tag.toLowerCase() === 'web') {
      const url = attrs.url || '';
      if (!url) return ''; // 没有链接的联网引用无法定位，丢弃（同网页端）
      const title = attrs.title || '';
      const n = push(`web|${url}`, { kind: 'web', url, title });
      return `[${n}](${CITE_WEB_PREFIX}${n})`;
    }

    const doc = attrs.doc || attrs.file_name || '';
    const kbId = attrs.kb_id || attrs.kbId || '';
    const chunkId = resolveCitationChunkId(attrs.chunk_id || attrs.chunkId || '', { doc, kbId }, references);
    // 文档名与 chunk 都缺失时无法定位，丢弃标记，避免留下无意义空胶囊
    if (!doc && !chunkId) return '';
    const n = push(`kb|${chunkId || doc}`, { kind: 'kb', doc, chunkId, kbId });
    return `[${n}](${CITE_KB_PREFIX}${n})`;
  });

  // [[wiki 页面]] 链接：与网页端同一套显示规则 ——
  // [[slug|显示名]] 用显示名；[[concepts/xxx]] 去掉第一段路径，显示 xxx
  text = text.replace(WIKI_LINK_RE, (_full, inner) => {
    const raw = String(inner || '').trim();
    if (!raw) return _full;
    const pipe = raw.indexOf('|');
    const slug = (pipe > 0 ? raw.slice(0, pipe) : raw).trim();
    if (!slug) return _full;
    let display = slug;
    if (pipe > 0) {
      display = raw.slice(pipe + 1).trim() || slug;
    } else {
      const parts = slug.split('/');
      display = parts.length > 1 ? parts.slice(1).join('/') : slug;
    }
    // 显示名里若含 Markdown 链接语法会破坏结构，做最必要的转义
    const safeDisplay = display.replace(/[[\]]/g, '');
    return `[${safeDisplay}](${WIKI_PREFIX}${encodeURIComponent(slug)})`;
  });

  return { text, markers };
}

export function hasCitations(content) {
  const s = String(content || '');
  return new RegExp(ANY_CITATION_TAG_RE.source, 'i').test(s) || /\[\[[^\]\n]+\]\]/.test(s);
}

// 思考块：部分模型（DeepSeek 系等）把推理写进正文的 <think>…</think>。
// 手机端此前同样因未知标签而完全看不到这段推理，这里抽出来交给「思考过程」折叠块。
const THINK_CLOSED_RE = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i;
const THINK_OPEN_RE = /<think(?:ing)?>/i;

export function extractInlineThinking(content) {
  const src = String(content || '');
  const closed = THINK_CLOSED_RE.exec(src);
  if (closed) {
    return { text: src.replace(closed[0], '').trimStart(), thinking: closed[1].trim() };
  }
  // 流式中尚未闭合：同样先按思考处理，边流边显示；否则这段时间正文一片空白
  const open = THINK_OPEN_RE.exec(src);
  if (open) {
    return {
      text: src.slice(0, open.index).trimStart(),
      thinking: src.slice(open.index + open[0].length).trim()
    };
  }
  return { text: src, thinking: '' };
}

/**
 * 把标记与后端返回的引用列表对上。
 * 优先用 chunk id 命中（references 的 id 就是 chunk id），再退回文件名匹配；
 * 都命中不了时返回兜底对象，由详情弹层按 chunk id 现取原文（与网页端一致）。
 */
export function resolveCitation(marker, references) {
  if (!marker) return null;
  if (marker.kind === 'web') {
    return {
      _web: true,
      url: marker.url,
      knowledge_title: marker.title || domainOf(marker.url),
      knowledge_filename: domainOf(marker.url)
    };
  }
  const list = Array.isArray(references) ? references : [];
  const hit = list.find((r) => marker.chunkId && r.id === marker.chunkId)
    || list.find((r) => marker.doc && (r.knowledge_filename === marker.doc || r.knowledge_title === marker.doc));
  if (hit) return hit;
  return {
    id: marker.chunkId,
    knowledge_title: marker.doc || '引用片段',
    knowledge_filename: marker.doc || '',
    knowledge_base_id: marker.kbId || '',
    content: '',
    _unmatched: true
  };
}
