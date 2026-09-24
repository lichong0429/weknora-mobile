<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.7.0

发布日期：2026-09-24

**P1 功能补齐**：批量下载（首次让 App 内下载真正可用）、解析失败原因可见、解析阶段时间线。附带修复一个「下载按钮按了没反应」的历史缺陷。

---

## 一、批量下载：先修基础设施，再做功能

### 原来为什么下不了

网页端与 App 内的下载体验完全不同，根因在 Android WebView 的能力边界：

| 方案 | 浏览器 / PWA | Android WebView |
|---|---|---|
| `<a href="blob:..." download>` | 可用 | **无效**（WebView 忽略 `download` 属性，blob 下载不实现） |
| `navigator.share({ files })` | 可用 | **不支持**（WebView 未实现 Web Share API） |
| 打开 URL 交给系统浏览器 | 可用 | 不可用（需要 `X-API-Key` 请求头 + POST body，浏览器给不了） |

也就是说 App 里原来的「下载文件」按钮**从来就点不动**（它是 `<a download>`），这不是修 bug 能解决的，必须有原生通路。

### 现在的实现

新增原生下载桥 `WeKnoraBridge.download(method, url, body, fileName, apiKey, requestId)`：

1. 前端把**绝对 URL + API Key + 请求体**交给原生（原生读不到 localStorage，因此由前端解析后传入）
2. 原生用 `HttpURLConnection` 直接发请求，**流式写入**磁盘，不经内存 —— 后端批量下载上限是 200 个文件 / 512 MiB，走「blob 转 base64 过桥」会直接撑爆 WebView 内存
3. 落盘位置：Android 10+ 写入 **`下载/WeKnora/`**（MediaStore，无需任何存储权限）；Android 9 及以下写入应用专属下载目录（同样免权限）
4. 完成/失败通过 `evaluateJavascript` 回调 `window.__weknoraDownload(requestId, ok, message)`，前端弹提示
5. 失败时不生成残缺文件：**先确认 HTTP 200 再创建目标文件**，并回滚已创建的 MediaStore 条目；错误消息优先取后端 JSON 的 `error.message`（如 403 权限不足）
6. 文件名消毒（剥离路径分隔符与控制字符）+ 优先采用服务端 `Content-Disposition`（含 RFC 5987 的 `filename*`），避免中文名乱码

非原生环境（PWA / 桌面浏览器）自动回退到 `fetch → blob → a[download]`，两条路径由同一个 `saveFile()` 入口分流。

### 批量下载入口

知识库文档列表 → 批量 → 选中 → **下载 ZIP**。前端按后端约束做了前置拦截：

- 超过 200 个文件直接拦下并提示分批（后端 `max=200`，否则传到一半才被 400 拒绝）
- 合计超过 300 MB 先弹确认（后端上限 512 MiB，弱网下大包体验差）
- 文件名形如 `知识库名_12份_2026-09-24.zip`

> 已知行为：后端对**无原文件的条目会自动跳过**（如纯手动创建的条目），ZIP 内条目数可能少于所选数量，这是服务端既有语义，不做前端伪造。

---

## 二、解析失败原因可见

### 之前

文档解析失败后，列表与详情页都只显示一个英文 `failed`。用户无法区分是文件损坏、格式不支持、体积超限，还是后端模型/队列异常 —— 只能反复点「重新解析」碰运气。

### 现在

`knowledge.error_message` 与 `/stages` 的 `last_error` 都会被展示：

- **列表行内**：失败条目直接显示失败原因（最多 2 行，超出省略）
- **详情页**：红色告警块显示「解析失败（阶段：分块）· ERROR_CODE」+ 完整原因文本
- 详情页同时提供**停止解析 / 重新解析 / 下载原文件**三个动作，与列表页的批量操作对应

---

## 三、解析阶段时间线（解析诊断）

调用 `GET /knowledge/{id}/stages`，把一次解析拆成 5 个阶段展示：

| 阶段 | 含义 |
|---|---|
| 文档解析 `docreader` | 原文件内容抽取 |
| 分块 `chunking` | 切分为可检索片段 |
| 向量化 `embedding` | 生成向量并写入索引 |
| 多模态 `multimodal` | 图片等多媒体处理（纯文本文档会标记为「跳过」） |
| 后处理 `postprocess` | 摘要 / 问题生成 / 图谱抽取等增强 |

设计要点：

- **炸伤范围可见**：后端按 DAG 依赖把失败阶段的下游标记为 `cancelled`，因此一眼能看出「分块失败 → 向量化/多模态/后处理全部取消」，而不是三个转圈的不确定状态
- **阶段状态语义**：等待 / 进行中 / 完成 / 失败 / 跳过 / 已取消，各自独立配色
- **不做假数据的诚实处理**：后端对启用追踪之前解析的旧文档会返回 5 个 pending 占位阶段。此时界面会明确标注「该条目没有阶段级追踪数据，上面的阶段状态取自文档当前状态，仅供参考」，而不是把占位符伪装成真实进度
- 展开后可看：第几次尝试（attempt / latest_attempt）、最后活动时间、队列状态（排队积压 / 疑似卡住）、最后一次错误

---

## 变更文件

**新增**

- `src/utils/nativeDownload.js` — 下载入口：原生桥优先，浏览器回退；含回调注册与 10 分钟超时
- `src/utils/labels.js` — 文档来源类型的中文映射（KBDetail / KnowledgeDetail 共用，避免文案漂移）

**修改**

- `webview-app/.../MainActivity.java` — 新增原生下载桥（流式写盘 + MediaStore + 错误提取 + JS 回调 + 文件名消毒）
- `src/api/client.js` — 新增 `buildApiUrl`、`downloadAsBlob`、`parseContentDispositionName`
- `src/api/endpoints.js` — 新增 `stages`、`downloadPath`、`batchDownloadPath`
- `src/utils/parseStatus.js` — 新增阶段语义（`STAGE_ORDER` / `extractStages` / `hasRealTrace` / `stageLabel` / `spanMeta` / `formatDuration`）；`formatBytes` 补齐 GB 档
- `src/components/KnowledgeDetail.jsx` — 解析诊断卡片、失败原因、启停/下载动作；`<a download>` 改为原生下载
- `src/components/KBDetail.jsx` — 批量下载（2×2 操作网格）、行内失败原因
- `package.json` / `webview-app/app/build.gradle` — 版本 1.7.0

## 验证

- webview 构建 + PWA 构建均通过
- 产物级校验：`batch-download` / `解析诊断` / `文档解析` / `下载 ZIP` / `__weknoraDownloadPending` / `WeKnoraBridge` 均已进入 bundle
- 阶段与状态工具函数单测 17 项通过（阶段顺序与后端常量一致、失败下游级联 cancelled、占位回退、真实 trace 判定、中文标签、格式化）
- Java 侧结构校验：花括号平衡、桥方法签名与 JS 调用签名一致（原生层由 CI 编译验证）
- 后端契约以官方 Go 源码为准核对：`BatchDownloadKnowledgeRequest{ ids }`（max 200 / 512 MiB）、`Knowledge.ErrorMessage`、`GET /knowledge/{id}/stages` 响应结构、`types.AllStages` 与 `SpanStatus*` 常量

## 尚未验证

1. **未对运行中的实例做端到端联调**（同 v1.6.0）：留存 API Key 对 `100.97.171.99` 返回 401，无可用凭据。接口契约来自官方源码。
2. **原生下载桥未经真机验证**：本机无 Android SDK，无法编译 Java，只做了结构核对。首次使用若失败，界面会显示后端返回的具体错误（如 403），Toast 会给出落盘路径或失败原因。
