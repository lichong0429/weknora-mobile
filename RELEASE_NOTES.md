<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.5.2

发布日期：2026-08-31

本版在 v1.5.1（图片与问答根因修复）基础上，增加**图片加载的并发控制**，
避免图片能正常显示之后，图片较多的 Wiki 页面出现「一直转圈」或内存尖峰。

> 若尚未安装 v1.5.1，直接安装本版即可，v1.5.1 的修复已包含在内。

---

## v1.5.1 的两项根因修复（本版已包含）

### 1. 图片加载失败（根治）

WeKnora 内部存储引用共有三类形态，定义于后端 `internal/storageurl.Pattern`：

```
resource://<handle>                     ← 默认形态（RESOURCE_URL_MODE=handle）
storage://<backend-id>/<provider>://…   ← canonical 形态
local|minio|s3|cos|tos|oss|obs|ks3://…  ← 遗留/直连形态
```

**`resource://` 是后端默认返回的形态**，而移动端此前识别内部引用的正则仅覆盖：

```js
/^(local|minio|cos|tos|s3|oss|ks3|obs):\/\//i   // 缺 resource:// 与 storage://
```

结果：`resource://xxx` 被判定为「普通 URL」直接赋给 `<img src>` → 浏览器无法解析该 scheme → 加载失败。

修复：按官方 `Pattern` 重写识别正则；排除 `/r/<token>`（后端签发的免鉴权公开 URL，可直接加载）；
失败提示显示具体错误码与截断后的源地址，并提供「重试」按钮。

### 2. 知识库提问没有回答（根治）

流式回答结束后，`finally` 中调用 `refreshMessages()` 拉取服务端历史，
`useEffect` 用服务端数据**整体覆盖**本地 `messages`：

```
流式显示完整回答 → 请求结束 → 拉取历史 → 服务端尚未落库完成 → 回答被清空
```

修复：

1. **流式期间禁止回写**：`streamingRef` 守卫，`useEffect` 直接跳过覆盖。
2. **合并策略**：服务端 assistant 内容为空而本地有内容时保留本地答案；
   服务端尚无该条消息时把本地答案补在末尾。
3. **延迟 800ms 回写**，为后端留出落库时间。
4. **降低门槛**：未从知识库跳转、且服务端只有一个知识库时自动选中。
5. **错误可见性**：请求错误在消息区顶部同步显示；未选知识库时常驻提示。

---

## 本版新增：图片并发控制

### 问题

图片修好之后，Wiki 这类图片较多的页面会一次性发起全部 `/files` 请求：

- 超出 WebView 单域名连接数后，请求长时间排队，表现为「图片一直转圈」；
- 瞬时创建大量 blob 对象，造成内存尖峰。

### 修复

在 `MarkdownImage.jsx` 收口一个全局并发池（`fetchImageBlob`），
`MarkdownImage` 组件与 `WikiView` 的 HTML hydrate 路径共用，上限 4。

- 任务按序完成，避免连接打满
- 已验证：40 个任务下峰值并发 = 4，结束后无 active 残留、无等待队列泄漏、无死锁

---

## 变更文件

- `src/components/MarkdownImage.jsx` — 内部引用识别正则、缓存键统一、失败重试、并发池
- `src/components/WikiView.jsx` — 失败提示带错误信息、失败不写缓存、接入并发池
- `src/components/Chat.jsx` — 流式回写守卫与合并策略、KB 自动选中、错误提示增强

## 验证

- webview 构建通过，并已确认修复进入最终 bundle：
  `resource://` / `storage://` 识别正则、`/r/<token>` 排除分支、并发池代码、
  以及新增的中文提示串（尚未选择知识库 / 图片加载失败 / 重试 / 服务器返回空内容）均在包内
- 内部引用识别正则 18 项用例全部通过（11 类应代理形态 + 7 类应直连形态）
- 并发池 40 任务测试通过（峰值 4、无泄漏、无死锁）

## 未启用的选项

后端支持 `?resource_urls=public` 让服务端直接返回可加载 URL，但源码明确：
**知识库受限（KB-restricted）的 API Key 会返回 403**（`storageurl.ErrPublicModeForbidden`）。
默认开启风险过高，故统一走 `/files` 鉴权代理，兼容所有 Key 类型。
