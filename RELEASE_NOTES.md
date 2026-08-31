<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.5.1

发布日期：2026-08-31

本次为**基于 WeKnora 后端源码实证**的修复版本。前几版图片与问答问题均基于推测，未命中根因；
本版直接对照官方仓库 `Tencent/WeKnora` 的路由与类型定义核实后再改。

---

## 修复 1：图片加载失败（根治）

### 根因

WeKnora 内部存储引用共有三类形态，定义于 `internal/storageurl.Pattern`：

```
resource://<handle>                     ← 默认形态（RESOURCE_URL_MODE=handle）
storage://<backend-id>/<provider>://…   ← canonical 形态
local|minio|s3|cos|tos|oss|obs|ks3://…  ← 遗留/直连形态
```

其中 **`resource://` 是后端默认返回的形态**，而移动端此前识别内部引用的正则仅覆盖：

```js
/^(local|minio|cos|tos|s3|oss|ks3|obs):\/\//i   // 缺 resource:// 与 storage://
```

结果：`resource://xxx` 被判定为「普通 URL」直接赋给 `<img src>` → 浏览器无法解析该 scheme → 加载失败。

### 修复

1. 按官方 `Pattern` 重写识别正则，覆盖全部三类形态（对齐 `internal/storageurl`）。
2. 排除 `/r/<token>`：这是后端为第三方渲染签发的**免鉴权公开 URL**，可直接用 `<img>` 加载，无需再走一次代理。
3. 失败提示增强：显示具体错误（如 `HTTP 403`）与截断后的源地址，并提供「重试」按钮，便于定位。

### 关于 `resource_urls=public`

后端支持 `?resource_urls=public` 让服务端直接返回可加载 URL，但源码明确：
**知识库受限（KB-restricted）的 API Key 会返回 403**（`storageurl.ErrPublicModeForbidden`）。
默认值风险过高，故**未启用**，统一走 `/files` 鉴权代理，兼容所有 Key 类型。

---

## 修复 2：知识库提问没有回答

### 根因（主）

流式回答结束后，`finally` 中调用 `refreshMessages()` 拉取服务端历史，
`useEffect` 用服务端数据**整体覆盖**本地 `messages`：

```
流式显示完整回答 → 请求结束 → 拉取历史 → 服务端尚未落库完成 → 回答被清空
```

观感即「提问后没有任何回答」。

### 修复

1. **流式期间禁止回写**：`streamingRef` 守卫，`useEffect` 直接跳过覆盖。
2. **合并策略**：流结束后回写时，若服务端 assistant 内容为空而本地有内容，保留本地内容；
   若服务端尚无该条消息，则把本地答案补在末尾。
3. **延迟 800ms 回写**，给后端留出落库时间。
4. **降低门槛**：未从知识库跳转、且服务端只有一个知识库时自动选中。
5. **错误可见性**：请求错误同时显示在消息区顶部（原先只在底部输入框上方，长对话中不可见）；
   未选择知识库时显示常驻提示。

### 关于请求协议（已核实无误）

对照后端源码确认以下实现均正确，非问题来源：

| 项 | 后端定义 | 移动端实现 | 结论 |
|---|---|---|---|
| 端点 | `POST /api/v1/knowledge-chat/:session_id` | 同 | ✅ |
| 请求体 | `query`、`knowledge_base_ids`、`summary_model_id` | 同 | ✅ |
| SSE 格式 | `c.SSEvent("message", StreamResponse)` | 已解析 | ✅ |
| 事件字段 | `response_type`（取值 `answer`/`thinking`/`complete`/`error`…） | 同 | ✅ |
| 文件代理 | `GET /api/v1/files?file_path=<provider://…>` | 同 | ✅ |

---

## 变更文件

- `src/components/MarkdownImage.jsx` — 内部引用识别正则、缓存键统一、失败重试
- `src/components/WikiView.jsx` — 失败提示带错误信息、失败不写缓存
- `src/components/Chat.jsx` — 流式回写守卫与合并策略、KB 自动选中、错误提示增强

## 验证

- `npm run build` 通过
- 内部引用识别正则 18 项用例全部通过（11 类应代理形态 + 7 类应直连形态）
