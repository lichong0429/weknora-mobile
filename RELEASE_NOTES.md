<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.7.2

发布日期：2026-09-25

**关键修复**：知识库问答「收不到回答」的真正根因已定位并修复 —— App 用 `done` 字段判断流结束，而后端第一个事件就带 `done:true`，导致客户端**在第一帧就退出**，一个回答都读不到。网页端正常、只有 App 收不到回答，原因就在这里。

---

## 一、根因（已用真实服务复现）

### 现象

知识库问答提问后，界面固定显示：

> 未收到回答。可能原因：①后端未配置大语言模型；②所选知识库无相关内容；③网络连接异常。

网页端同一知识库、同一问题一切正常。

### 定位过程

对实际部署（NAS 上的 WeKnora 0.8.0）直接发起问答并抓原始 SSE，服务端**完全正常**：

- 版本 0.8.0，3 个「知识问答」类型模型全部可用（逐个实测均能出答案）
- 检索命中、20+ 个 `answer` 事件、正常收到 `complete`
- 换端口（8080 / 8088）、换 `Accept` 头、换模型、换知识库，全部正常

问题出在客户端。抓到的**第一个事件**是：

```json
{"response_type":"agent_query","content":"","done":true, ...}
```

而 App 的读取循环写的是：

```js
for await (const ev of chatStream(...)) {
  ...
  if (done) break;      // ← 第一帧就命中，直接退出
}
```

`done` 在 WeKnora 的协议里表示「**该事件本身**已完整」，**不是**「整条流结束」。
后端源码注释写得很明确（`internal/handler/session/helpers.go`）：

> The frontend should use **'complete'** response_type to detect stream completion
> Sending an extra empty 'answer' event with done:true causes frontend issues

第一个事件 `agent_query` 就是用来在回放会话时标注「用户问了什么」的，它自带 `done:true`。
于是客户端在第一帧退出 → 没有 answer → 触发「未收到回答」提示。

### 证据

用 App 的原始循环逻辑回放真实事件序列：

```
服务端实际发出 18 个事件：
  #0 type=agent_query  done=True   content_len=0     ← App 在这里 break
  #1 type=tool_call    done=False
  #2 type=tool_result  done=False
  #3.. answer ×多帧
=== 复刻 App 逻辑的结果 ===
在第 0 个事件处 break（done=true）
最终 answer 内容长度: 0
App 会认为"收到回答"吗: False
→ 结论：App 会显示「未收到回答」，尽管后端实际发了回答。

对照（改为仅在 complete 时结束）: answer 长度 = 236
```

### 修复

新增 `src/utils/chatStreamProtocol.js`，把终止语义独立成可测试的模块：

- **只有** `response_type === 'complete'` 视为流结束
- `error` 且 `done:true` 也表示服务端已终止本轮（否则会一直空等连接关闭）
- 其余事件类型（`agent_query` / `tool_call` / `tool_result` / `references` / `thinking` …）
  无论 `done` 取值都必须继续读取

### 防回归

新增 `scripts/test-stream-protocol.mjs`，用从真实服务抓下来的事件序列（只保留类型与
`done` 取值，不含任何正文）同时验证「旧逻辑必然拿不到回答」与「新逻辑能读全回答」，
共 14 项断言。已接入 `npm run check` 与 CI：这个 bug 不可能再悄悄回来。

---

## 二、同版本附带的两项改进

1. **诊断能力**：问答失败不再给三句无法互斥的猜测，而是按「实际收到了什么」给出唯一结论
   （未建连 / 鉴权 / 路由 / 5xx / 非 SSE / 帧全解析失败 / 零字节 / 后端错误事件 /
   流被切断 / 正常结束但无内容），并可一键复制证据。
2. **诊断页「问答链路自检」**：真实发一次最小提问并观察事件流，同时检查后端是否存在
   KnowledgeQA 类型模型；使用临时会话，结束后自动删除。

## 变更文件

- `src/utils/chatStreamProtocol.js` — 新增（终止语义 + 注释记录事故背景）
- `scripts/test-stream-protocol.mjs` — 新增（14 项回归断言）
- `src/components/Chat.jsx` — 终止条件由 `done` 改为 `isTerminalStreamEvent`
- `.github/workflows/build-apk.yml` — CI 增加回归测试步骤
- `package.json` / `webview-app/app/build.gradle` — 版本 1.7.2

## 验证

- 对真实部署逐项实测：后端版本/模型/端口/Accept 头/模型选择/知识库内容匹配度，确认服务端无异常
- 用真实事件序列证明旧逻辑在第 0 帧退出、新逻辑读到全部回答
- 回归测试 14 项通过；构建通过；产物校验确认终止集合已打包且旧的 `done) break` 已消失
- 安全体检通过（无阻断项）

## 尚未验证

真机复测由用户完成：本次修复针对客户端循环逻辑，已在真实服务的事件序列上验证，
但未在手机实机跑过完整交互。
