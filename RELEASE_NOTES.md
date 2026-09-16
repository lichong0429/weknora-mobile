<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.5.4

发布日期：2026-09-17

**紧急修复**：v1.5.3 引入了一个会导致「知识库文档页一片空白、且无法返回」的回归，本版修正。

---

## 修复：文档页白屏且无法返回（v1.5.3 回归）

### 现象

从知识库点进任意文档条目，页面**一片空白**，底部导航与返回按钮同时消失，**无法返回**。

### 根因

v1.5.3 为修复图片显示，在该页面新增了 `useImageHydrate` 调用，但**放在了提前 return 之后**：

```js
if (loading)   return <加载中… />;   // ← 首帧必然命中
if (error)     return <错误 />;
if (!knowledge) return <未找到 />;

const isHtml = isHtmlContent(preview);
useImageHydrate(previewHtmlRef, displayPreview, isHtml);   // ← 位置错误
```

React 要求每次渲染的 hook 调用**数量与顺序完全一致**。而 `useAsync` 的初始状态是
`loading=false`、`data=null`，因此：

| 渲染 | 状态 | 是否执行到该 hook | 累计 hook 数 |
|---|---|---|---|
| 第 1 帧 | 初始，命中 `if (loading)` | 否 | N |
| 第 2 帧 | 数据到达，越过所有 return | 是 | N + 2 |

第 2 帧 hook 数量多于第 1 帧，React 直接抛错并**卸载整棵组件树** ——
连 Layout（底部导航、返回按钮、手势返回）也一并消失，所以「返回不了」。

### 修复

把 `isHtml` / `displayPreview` / `isTruncated` 的计算与两个 `useImageHydrate`
**整体上移到所有提前 return 之前**，保证每帧 hook 数量恒定。并在该处留下警示注释。

### 加固一：新增页面级错误边界

此前项目没有错误边界，任何一处渲染异常都会让**整个 App 白屏**，用户既看不懂也无法自救。
新增 `ErrorBoundary` 并包在 `<Outlet />` 外层：

- 单个页面崩溃不再影响其他页面与底部导航
- 崩溃时给出「重试」与「返回」按钮，并提供错误信息
- 以路由路径作为 key，切换到其他页面时自动重新挂载、清空错误状态

### 加固二：新增 Hook 顺序静态检查

新增 `scripts/check-hooks-order.py`，扫描全部组件的 hook 调用是否落在提前 return 之后。

- 本次已全量扫描 33 个组件/上下文文件：除已修复项外，其余均正常
  （`VectorStoreList.jsx` 报出的一处经人工确认是辅助函数内的 `if`，属误报）
- 这类问题构建期不报错、产物字符串校验也发现不了，只能靠静态检查或实机验证

---

## 变更文件

- `src/components/KnowledgeDetail.jsx` — hook 上移至提前 return 之前（根因修复）
- `src/components/ErrorBoundary.jsx` — 新增（页面级错误边界）
- `src/components/Layout.jsx` — 用 ErrorBoundary 包裹 Outlet
- `scripts/check-hooks-order.py` — 新增（hook 顺序静态检查工具）

## 验证

- webview 构建通过
- hook 位置确认：`useImageHydrate`（L245）位于全部提前 return（L248 / L256 / L264）之前
- 全量扫描 33 个文件，无其他 hook 顺序隐患
