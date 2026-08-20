<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.1

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.0...v1.4.1

## 修复（移动端 4 个功能问题）

- **页面无法滚动到底 / 底部功能栏遮挡**：内容容器改用 `min-h-full` 并加大底部留白；悬浮 Tab Bar 仅在 5 个主 Tab 页面显示，子页面（会话 / 知识详情等）自动隐藏，不再与页面自身输入区叠加遮挡。
- **条目预览只能半屏 + 渲染异常**：预览内容支持点击进入**全屏阅读**（滚动 + 关闭按钮）；Markdown 渲染补充 `rehype-raw`，文档内嵌 HTML 正常显示；图片预览点击可全屏放大。
- **搜索框挤掉添加按钮**：知识库文档工具栏拆分为两行——第一行搜索 + 筛选 + 刷新，第二行上传 / 添加按钮均分宽度。
- **上传按钮点击无反应**：改为按钮 + `ref.click()` 显式触发文件选择，确保点击必响应；上传中显示「上传中…」状态。

## 版本号

- 应用版本号统一更新为 **1.4.1**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082022 + versionName 同步）。

## 校验

- 修改的 3 个文件（Layout / KBDetail / KnowledgeDetail）经 Vite 全量打包校验通过，PWA Service Worker 正常生成。
