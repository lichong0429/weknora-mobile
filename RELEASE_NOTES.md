<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.7.4

发布日期：2026-09-29

**修复**：知识库设置里选好模型后「提示保存成功、实际没保存」——根因是请求体形状不符合后端契约，模型字段被后端静默丢弃。

---

## 一、根因：配置平铺在顶层，被后端静默忽略

`PUT /knowledge-bases/{id}` 的请求体是：

```go
type UpdateKnowledgeBaseRequest struct {
    Name        string                     `json:"name" binding:"required"`
    Description string                     `json:"description"`
    Config      *types.KnowledgeBaseConfig `json:"config"`
}
```

也就是说，配置必须**嵌套在 `config` 下**；而 `KnowledgeBaseConfig` 只包含
`chunking_config` / `image_processing_config` / `faq_config` / `wiki_config` /
`auto_tag_config` / `profile_config` / `indexing_strategy`。

旧版把 `embedding_model_id`、`summary_model_id`、`vlm_config`、`indexing_strategy`、
`wiki_config` 全部**平铺在顶层**。Go 的 `json` 解码器默认忽略未知字段，于是：

- `name` / `description` 正常落库 → 接口返回成功 → 界面提示「保存成功」
- 模型与索引配置**一步都没有写入**

这正是「显示保存成功，但回头一看还是没选上」的原因。实测对照（真实部署）：

| 请求体形状 | 结果 |
|---|---|
| 顶层平铺（旧版） | `indexing_strategy.vector_enabled` 保持原值 → 未保存 |
| 嵌套 `config`（本次） | `vector_enabled` / `wiki_enabled` / `wiki_config` 全部正确落库 |

## 二、模型配置走独立端点

模型字段在设计上就不属于 `PUT /knowledge-bases/{id}`。网页端把保存拆成两次调用，
手机端按同一契约对齐：

| 调用 | 用途 | 关键点 |
|---|---|---|
| `PUT /knowledge-bases/{id}` | 名称、描述、索引策略、Wiki 配置 | 配置必须嵌在 `config` 下 |
| `PUT /initialization/config/{id}` | Embedding / 摘要 / VLM / 分块 | camelCase；`vlm_config` 及其子字段为 snake_case；`llmModelId` 必填 |

对 `documentSplitting` 的 `strategy` / `tokenLimit` / `languages` /
`tableMetadataInstructions` 四个字段，后端用指针区分「未提供 = 保持不变」与
「显式空值 = 清空」，因此只在原值存在时才携带，避免把用户既有设置清掉。

## 三、不再用「乐观更新」冒充成功

旧版保存后直接用本地对象更新界面并提示成功——**这正是假成功得以存在的原因**。
现在保存后会回读知识库，逐项比对服务端真实状态：

- 全部一致 → 「保存成功（已回读确认生效）」
- 有项目未被接受 → 明确列出是哪几项，例如「服务端未接受：摘要 / 合成模型、Wiki 索引」

这样即便将来后端契约再变化，也会立刻暴露，而不是静默丢数据。

## 四、顺带改进

直接加载（非代理）的图片此前没有任何失败反馈：取不到就静默空白，用户既看不到图、
也不知道为什么。现在会显示失败原因并支持重试。

## 五、验证

- 新增 `scripts/test-kb-settings-payload.mjs`（27 项断言）：锁定「配置必须嵌套」、
  「模型字段不得出现在顶层」、「指针字段不误清空」、「回读比对能判出未保存」
- 端到端实证（真实部署、临时知识库、跑完即删）：两次调用后回读差异为空，
  `embedding_model_id` / `summary_model_id` / `vlm_config` / `wiki_enabled` /
  `wiki_config` 全部落库
- 安全体检、流语义回归（14 项）、引用解析回归、hook 顺序检查全部通过

## 六、已知问题（服务端，非本应用可修）

对部署实例抽样实测：**238 个手动录入（.md）文档全部可正常下载，122 个 PDF 全部 500**，
错误为 `failed to open file: open /data/files/10000/<doc-id>/xxx.pdf: no such file or directory`；
PDF 抽取出的图片（`/data/files/10000/exports/*.jpg`）同样不存在。

即：数据库里的分块与文本完好（问答仍可用），但**磁盘上的二进制文件已丢失**。
因此部分文档内的图片无法显示与客户端逻辑无关，需在服务端排查本地存储卷。
