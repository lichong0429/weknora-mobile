<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.6.0

发布日期：2026-09-24

**P0 功能补齐**：把网页端的「上传/解析过程控制」搬到手机端 —— 上传任务队列（真实进度、取消、重试）、解析进度自动轮询、批量开始/停止解析。同时修正了一个会让批量删除**永远失败**的字段名错误。

---

## 一、上传任务队列（网页端已有的能力）

### 之前的问题

上传走的是「选文件 → `await` 上传 → 全量刷新列表」的单发模式：

- **没有进度**，大文件上传时界面只有一个「上传中…」，无法判断是卡住还是在跑
- **不能多选**，一次只能选一个文件
- **不能取消、不能重试**，传错或者网络抖动只能重来
- 上传期间按钮禁用，想继续浏览列表都不方便

### 现在的行为

- 文件选择支持**多选**，选中后进入队列面板
- **串行上传**（并发 1）：手机网络下并发上传会互相抢带宽，进度条会集体卡在中段，反而像卡死；串行保证任意时刻只有一个可中断的传输
- 每个任务展示**真实上传百分比**（来自 XHR 的 `upload.onprogress`，不是估算）
- 每个任务可**取消**（中断传输）、失败可**重试**（复用同一个 File 对象）、可**从列表移除**
- 底部「清除已完成」一键清理

> 为什么序列号是串行而不是并发 3：WebView 单域名连接数有限，并发上传会和文档列表、图片代理请求互相排队，整体更慢。

### 已验证的取舍

**上传中离开页面不会中断上传。** 上传是用户显式发起的写操作，中断会直接丢掉这次上传且没有任何补偿，因此刻意不在组件卸载时 `abort()`。代价是离开页面后看不到进度、也无法取消，但文件会正常入库，回到列表即可看到。

> 附带修掉一个隐患：早期实现若在卸载时中断，会与 React StrictMode 的「挂载→卸载→再挂载」检查冲突，导致开发环境下刚发起的上传立即失败；同时在真机上表现为「上传中一点开文档就取消上传」。现已改为后台继续 + 同步去重守卫（同一任务不会被推进两次）。

---

## 二、解析进度自动轮询

### 之前的问题

文档列表的 `parse_status` 只在手动点刷新时更新。上传完一批文件后，用户只能反复点刷新按钮猜「解析好了没有」。

### 现在的行为

- 列表中存在 `pending` / `processing` / `finalizing` 状态的文档时，**每 4 秒静默刷新一次**，全部落到终态后**立即停止**（不空转请求）
- 刷新按钮会出现旋转态并显示「解析进度自动刷新中」，让用户知道数据是活的
- **停滞降频**：全部在解析中的文档超过 20 分钟没有推进（依据 `last_activity_at`），轮询降频到 15 秒，减少对后端的无效压力，并提示「后台解析中（已降频）」
- **切后台暂停**：页面不可见时跳过轮询，回到前台立即补一次刷新（手机省电与避免连接被系统回收）
- 静默刷新按「当前已加载条数」拉取等量数据整体替换，不打断无限滚动的滚动位置、也不出现 loading 闪烁

### 关于「解析进度百分比」

**故意没有做进度条。** 后端 `knowledge` 对象只下发 `parse_status`，没有解析百分比字段（`pending_subtasks_count` 只在 `finalizing` 阶段有意义）。伪造一个动的进度条属于欺骗性 UI，因此解析态用不定量 spinner + 状态文案（`解析中` / `收尾中`），只有**上传**阶段给真实百分比。

---

## 三、批量开始 / 停止解析

批量模式下，操作条从「只有删除」扩展为三个动作：

| 动作 | 底层接口 | 说明 |
|---|---|---|
| 重新解析 | `POST /knowledge/batch-reparse` `{kb_id, ids}` | 后端异步任务队列（asynq），提交即返回，进度由轮询体现 |
| 停止解析 | 逐条 `POST /knowledge/{id}/cancel-parse` | 后端**没有**批量取消接口，用 `Promise.allSettled` 并发逐条调用，个别失败不影响其余，并汇总「成功 N / 失败 M」 |
| 删除 | `POST /knowledge/batch-delete` `{kb_id, ids}` | 修正字段名（见下） |

- 「停止解析」按钮只对**选中项中的 in-flight 文档**可用，并显示可停止数量，避免点下去无反应
- 停止前明确告知：已生成的分块与索引会保留，可随时重新解析
- 列表**行内快捷操作**：解析中的文档右侧直接给「停止」，失败/已取消的给「重新解析」，无需进详情页
- 文档状态由英文原值（`processing`）改为中文标签 + 配色（解析中 / 收尾中 / 已完成 / 失败 / 已取消 / 待解析）

---

## 四、修复：批量删除从未生效

`src/api/endpoints.js` 中批量删除发的是 camelCase：

```js
batchRemove: (kbId, ids) => post('/knowledge/batch-delete', { kbId, ids })   // ← 错误
```

而后端 `BatchDeleteKnowledgeRequest` 的字段是 snake_case，且为必填：

```go
type BatchDeleteKnowledgeRequest struct {
    KBID string   `json:"kb_id" binding:"required"`
    IDs  []string `json:"ids"  binding:"required"`
}
```

`kb_id` 缺失会直接命中 binding 校验，返回 400 `Invalid request parameters`。也就是说**这个功能此前从未成功过**。

附带的第二个问题：调用处写的是 `await batchRemove(...) || Promise.all(逐条删除)` —— `||` 作用于 Promise 对象永远为真，兜底分支是死代码。

现在：字段名修正为 `kb_id`；兜底逻辑改为**仅在**批量接口不存在（HTTP 404/405）时退化为逐条删除，其他错误（403 权限、409 冲突）原样抛出，不再把真实原因掩盖成 N 次同样的失败。

> 该缺陷与「批量重新解析」是同一个根因类别（请求体字段命名），因此新增接口时统一按后端 Go struct 的 `json` tag 命名，不再凭前端习惯写 camelCase。

---

## 变更文件

**新增**

- `src/hooks/useUploadQueue.js` — 串行上传队列（取消/重试/去重守卫/后台续传）
- `src/hooks/useParsePolling.js` — 解析进度轮询（停滞降频、切后台暂停）
- `src/components/UploadTaskPanel.jsx` — 上传任务面板
- `src/utils/parseStatus.js` — 解析状态语义、在飞行判定、停滞判定、格式化

**修改**

- `src/api/client.js` — 新增 `uploadFileWithProgress`（XHR 真实进度 + AbortSignal）
- `src/api/endpoints.js` — 修正 `batchRemove` 字段名；新增 `batchReparse`
- `src/components/KBDetail.jsx` — 多选上传、批量启停解析、行内快捷操作、状态本地化、接入轮询
- `webview-app/app/build.gradle` / `package.json` — 版本 1.6.0

## 验证

- webview 构建 + PWA 构建均通过
- 产物级校验：`batch-reparse` / `kb_id` / 状态文案 / `visibilitychange` / `Aborted` 均已进入 bundle
- hook 顺序静态检查通过（`KnowledgeDetail`/`KBDetail` 无隐患；`VectorStoreList` 为已记录误报）
- `parseStatus` 逻辑单测 11 项通过（在飞行判定、签名生成、停滞判定、状态中文化、格式化）
- 后端契约以官方 Go 源码为准核对（`internal/types/knowledge.go` 状态常量、`internal/handler/knowledge.go` 请求 schema、`internal/router/routes_knowledge.go` 路由）

## 尚未验证

**未对运行中的实例做端到端联调**：仓库与记忆中留存的 API Key 对 `100.97.171.99` 返回 401 unauthorized，无可用凭据。因此上面的接口契约来自官方源码，而非一次真实往返。若实际使用中出现失败，界面会直接显示 HTTP 状态码与后端错误消息（如 403 / 400），据此可一次定位。
