<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.3

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.2...v1.4.3

## 修复

- **全屏预览打开生硬、无动画**：新增淡入 + 上滑过渡动画（0.28s ease-out），点击全屏阅读不再生硬跳变。
- **关闭按钮重新设计**：改为右上角圆形轻量图标按钮（灰色圆底 + X），悬停/按压有反馈，与整体视觉统一。
- **系统返回键直接退出软件（根治）**：WebView 加载 `file://` 时 `history.pushState` 不可用，此前依赖它的方案失效导致返回键直接退出应用。改为原生层在 `onBackPressed` 中先询问前端（`window.__wbOnBack`），全屏打开时返回键先关闭预览，再按一次才退出页面/应用。
- **Markdown 渲染不完整（根治）**：预览与聊天消息原先使用 `prose` 类，但项目未安装 `@tailwindcss/typography` 插件导致样式完全未生效。统一改用内置 `.md-body` 排版类（标题/列表/代码块/表格/引用/图片均正确渲染），聊天 AI 回复同步修复。

## 版本号

- 应用版本号统一更新为 **1.4.3**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082100 + versionName 同步）。

## 校验

- 前端（KnowledgeDetail / Chat / index.css）经 Vite 全量打包校验通过。
- Android 原生层（MainActivity 返回键桥）代码自查通过，CI 完成 APK 构建。
