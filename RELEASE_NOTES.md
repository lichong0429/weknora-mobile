<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.2.8

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.2.7...v1.2.8

## 新功能

- **知识库一键开始对话**：KB 详情页新增「开始对话」按钮，自动创建含知识库上下文的会话，进入聊天页后自动预选该 KB。
- **智能体模型配置**：AgentDetail 新增 LLM 模型、摘要模型、Rerank 模型下拉选择器 + 知识库多选绑定，与网页端对齐。
- **模型测试连接**：模型编辑页新增「测试连接」按钮，实时反馈连接成功/失败及延迟。
- **首页功能中心**：首页扩展为 10 项功能入口（知识库/搜索/会话/智能体/模型/向量库/搜索引擎/系统/诊断/设置），隐藏的高级功能全部可直达。
- **Release 正文自动填充**：CI 发布时自动读取 `RELEASE_NOTES.md` 填充 Release body（带 fallback）。

## 修复

- **文档预览空白**：预览提取拓宽字段兼容（content/text/preview/body/markdown/html/answer/document/summary/parsed_content），新增 JSON 响应正文提取，预览为空时回退展示「分块内容」。
- **基于知识库提问无回答**：聊天页 SSE 兼容 `response_type` 与 `type` 双字段名；payload 自动回退 session 绑定的 KB ID。
- **AgentDetail** 保存时将 `model_id`/`summary_model_id`/`rerank_model_id`/`knowledge_base_ids` 正确写入 config。

## 校验
- 全部改动（9 文件，+350 / -40）通过 esbuild 全量打包校验。
- 提交 `186c81d` 已落在 `origin/main` 顶端（fast-forward，无冲突）。
