<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.2

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.1...v1.4.2

## 修复

- **全屏预览侵入系统栏 / 无法关闭**：
  - 原生层应用系统栏 inset（Android 15+ 强制 edge-to-edge 的适配），WebView 内容始终落在安全区内，不再进入状态栏/导航栏/任务栏区域。
  - 全屏预览顶部改为常驻大号「关闭」按钮（带文字），不再依赖角落小图标。
  - 打开全屏时压入 history 状态，**Android 系统返回键可直接退出全屏**，不会误退页面。
- **上传文件点击无反应（根治）**：APK 原生层实现 `WebChromeClient.onShowFileChooser` + `registerForActivityResult`，Android WebView 点击 `<input type="file">` 时正确弹出系统文件选择器（此前默认 WebChromeClient 无此实现，点击静默无效）。

## 版本号

- 应用版本号统一更新为 **1.4.2**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082023 + versionName 同步）。

## 校验

- 前端（Layout / KnowledgeDetail）经 Vite 全量打包校验通过。
- Android 原生层（MainActivity / activity_main.xml）代码自查通过，CI 完成 APK 构建。
