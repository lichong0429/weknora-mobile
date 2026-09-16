<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.5.3

发布日期：2026-09-16

本版修复两个问题：**主页数据概览不更新**、**图片在部分页面仍不显示**。

---

## 修复 1：主页数据概览不更新

### 根因

`Home.jsx` 里的概览数字与「最近访问」是**硬编码常量**，从未调用任何接口：

```js
const stats = [
  { value: '12',    label: '知识库' },
  { value: '3,842', label: '文档'   },
  { value: '56',    label: '会话'   }
];
```

因此它显示的一直是示例数据，与真实数据无关，也不可能更新。
`KBList.jsx` 头部的「12 个知识库 · 3,842 文档」同样是写死的。

### 修复

概览改为实时拉取真实接口：

| 指标 | 数据来源 |
|---|---|
| 知识库 | `GET /knowledge-bases` 返回条数 |
| 文档 | 各知识库 `knowledge_count` 累加 |
| 会话 | `GET /sessions` 的 `total`（缺失时回落为当前页条数） |
| 最近访问 | 知识库按 `updated_at` 倒序取前 3，显示文档数与相对更新时间 |

配套改进：

- 数据依赖 `location.key`，**每次进入首页/知识库页都重新拉取**，不再显示旧数据
- 「数据概览」标题旁新增手动**刷新**按钮
- 新增加载中、加载失败、无知识库三种状态提示
- 千分位格式化（如 `3,842`）；`KBList` 头部同步改为真实统计

---

## 修复 2：图片仍不显示

上一版（v1.5.1）修正了 `resource://` 等内部引用的识别，但**仍有两条渲染路径未接图片处理**，本版补齐：

### 遗漏 A：知识条目的 HTML 预览

`KnowledgeDetail` 在判定内容为 HTML 时走 `dangerouslySetInnerHTML`，
该路径**完全没有图片处理**——里面的 `resource://` 图片不会被转成 blob，必然不显示。
（Markdown 路径此前已正确接入。）

修复：HTML 路径接入 `resolveImageUrls` + `useImageHydrate`，预览区与全屏区两处都覆盖。

### 遗漏 B：问答消息

`Chat.jsx` 的 `ReactMarkdown` 未传 `components={{ img: MarkdownImage }}`，
问答回答与引用片段中的图片走原生 `<img>`，无法携带鉴权头，必然加载失败。

修复：补上 `img` 组件，并启用 `rehypeRaw` 以兼容回答中的内联 HTML 图片。

### 配套：把图片处理抽为公共能力

此前 hydrate 逻辑内联在 WikiView 中。现抽取为共用实现，三处渲染路径行为一致：

- `MarkdownImage.jsx` → `resolveImageUrls()`：处理 HTML 字符串里的 `<img src>` / `<source srcset>`
- `hooks/useImageHydrate.js` → `useImageHydrate()`：扫描 DOM 把服务器图片换成经鉴权代理的 blob
- WikiView 改用公共实现（重复代码减少约 2,700 字符）

### 失败提示可操作化

图片加载失败时不再只显示「加载失败」，而是给出可定位的原因：

- `HTTP 403` → 明确提示「API Key 权限不足：`/files` 代理要求全权限 Key，知识库受限的 Key 会被拒绝」
- `HTTP 401` → 提示 API Key 无效，去设置页检查
- `服务器返回空内容` → 后端文件路径配置问题

---

## 变更文件

- `src/components/Home.jsx` — 概览接入真实接口、刷新按钮、加载/错误/空态
- `src/components/KBList.jsx` — 头部统计改真实值、进入页面自动刷新
- `src/components/KnowledgeDetail.jsx` — HTML 预览路径接入图片处理（预览区 + 全屏区）
- `src/components/Chat.jsx` — 回答补 `img` 组件 + `rehypeRaw`
- `src/components/MarkdownImage.jsx` — 新增 `resolveImageUrls()`、`describeImageError()`
- `src/components/WikiView.jsx` — 改用公共图片处理实现
- `src/hooks/useImageHydrate.js` — 新增（公共 DOM 图片 hydrate）

## 验证

- webview 构建通过
- 产物校验 11 项全部命中：主页空态/刷新/错误提示/数据概览/最近访问、
  图片失败提示/HTML 地址解析/`resource://`/`storage://`/`srcset`、知识库页统计
- 已确认旧的硬编码假数据（`3,842`、`12 个知识库`）**完全从产物中消失**
