<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.6

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.5...v1.4.6

## 修复

- **知识条目预览显示不完整（显示到 ~4500 字符就停，网页端正常）**：
  - 根因：`fetchPreview` 对文本类预览原先只读取前 **6064 字节**就中断下载（设计初衷是防止大文档 OOM），导致长文档预览被硬截断成约 4,500 字符（中英混合编码下 6064 字节 ≈ 4,490 字符，与用户看到的 4507 完全吻合）。网页端无此限制，故显示完整。
  - 修复：文本类预览读取上限提升到 **2MB**（覆盖绝大多数文档），配合前端展示上限从 6,000 提升到 **30,000** 字符，超过仍保留「展开全部」。
  - 后端数据本身完整，无需改动。

## 版本号

- 应用版本号统一更新为 **1.4.6**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082412 + versionName 同步）。

## 校验

- 前端（client.js / KnowledgeDetail.jsx）经 Vite 全量打包校验通过，无 6064 限制残留。
