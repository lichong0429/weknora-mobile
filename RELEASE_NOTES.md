<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.9

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.8...v1.4.9

## 修复

- **「跟随系统」无法自动切换（根治）**：根因是 App 主题为 `Theme.AppCompat.Light`（固定浅色），WebView 上报的 `prefers-color-scheme` 恒为 light，前端 `matchMedia` 监听永不触发。改为 `Theme.AppCompat.DayNight` 主题，并在 `configChanges` 加入 `uiMode`——系统深色/浅色切换时 Activity 不重建、WebView 自动更新 `prefers-color-scheme`，前端「跟随系统」档即时联动。
- **深色主题下状态栏/导航栏仍为白色（根治）**：根因是 edge-to-edge 下状态栏区域背景取自 `root_layout`（默认白），此前只设了图标颜色、未设背景色。现按明暗同步设置 `root_layout` 背景色、`setStatusBarColor`、`setNavigationBarColor`，并配合图标明暗；启动时按系统状态初始化，系统切换时 `onConfigurationChanged` 兜底同步。

## 版本号

- 应用版本号统一更新为 **1.4.9**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082809 + versionName 同步）。

## 校验

- 前端（ConfigContext）经 Vite 全量打包校验通过。
- Android 原生层（MainActivity 主题/状态栏 + styles.xml DayNight + Manifest uiMode）代码自查通过，CI 完成 APK 构建。
