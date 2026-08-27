<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.8

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.7...v1.4.8

## 修复

- **「跟随系统」无法自动切换（根治）**：根因是原生层 App 主题固定为浅色，WebView 上报给前端的 `prefers-color-scheme: dark` 恒为 false。新增原生 JS 桥（`WeKnoraBridge.setTheme`），前端切换主题时同步原生系统深色模式，`system` 档读取系统真实深色状态，系统切换深色/浅色时自动联动。
- **深色主题下状态栏/导航栏仍为白色（根治）**：原生层按当前明暗设置状态栏与导航栏图标颜色（深色→浅色图标，浅色→深色图标）。
- **系统返回键/手势返回仍直接退出软件（根治）**：根因是 targetSdk 33+ 下系统返回走 `OnBackPressedDispatcher`，不再调用 `Activity.onBackPressed()`。改为用 `OnBackPressedDispatcher` 注册回调，非首页返回上一页、首页才退出。
- **超长条目预览只显示 3 万字**：根因是 `loadPreview` 把预览数据本身硬截断到 30,000 字符（`setPreview(text.slice(0, 30000))`），「展开全部」也无济于事。改为完整保存数据，30,000 仅作为默认折叠长度，展开后可读完整内容（配合 2MB 读取上限）。

## 版本号

- 应用版本号统一更新为 **1.4.8**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082800 + versionName 同步）。

## 校验

- 前端（ConfigContext / KnowledgeDetail）经 Vite 全量打包校验通过。
- Android 原生层（MainActivity 返回回调 + JS 桥）代码自查通过，CI 完成 APK 构建。
