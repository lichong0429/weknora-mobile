<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.3.0

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.2.9...v1.3.0

## 修复

- **修复对话无回答**：从知识库「开始对话」/ 智能体「测试对话」跳转时，通过路由 state 正确预选知识库与智能体，聊天请求正确携带 `knowledge_base_ids`（此前会话创建传的 `knowledge_base_id` 被后端忽略，导致检索不到知识库）。
- **修复模型覆盖参数**：对话中切换模型改用 `summary_model_id`（WeKnora 知识问答接口的正确字段，此前误用 `model_id`）。
- **修复搜索无结果**：搜索页改用健壮的列表解析，正确提取知识库 ID 列表；未找到知识库时给出明确提示。

## 优化

- 提问时若未选择任何知识库或智能体，会明确提示「请先选择知识库或智能体」，不再静默发送空请求。

## 版本号

- 应用版本号统一更新为 **1.3.0**（package.json / 诊断页 APP_VERSION / APK versionName 同步）。

## 校验
- 4 个功能文件 + 版本号改动通过 esbuild 全量打包校验。
- 已对照 WeKnora 官方（Tencent/WeKnora）API 文档核对接口契约。
