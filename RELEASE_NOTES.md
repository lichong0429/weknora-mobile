<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.0

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.3.1...v1.4.0

## 视觉升级（UI 全面美化）

- **品牌视觉体系**：新增 `brand` / `surface` / `ink` / `accent` 设计令牌（Tailwind 扩展），主色升级为 indigo-violet 渐变（`#5B5BD6 → #8B5CF6`），暖灰画布底色 `#F6F7F9`。
- **首页重构**：品牌渐变 Hero 卡片 + 内嵌搜索框、2×2 快捷入口网格、数据概览（知识库/文档/会话统计）、最近访问列表。
- **知识库列表**：大标题 + 副标题统计、渐变新建按钮、圆角 KB 卡片（图标/置顶/统计/时间）、品牌化空状态与弹窗。
- **语义搜索**：圆角搜索框（focus 品牌色）、知识库筛选 chips 改为品牌渐变选中态、结果卡片带来源图标与相关度评分徽章。
- **会话聊天**：用户消息品牌渐变气泡、AI 消息白色圆角气泡（引用区品牌化）、渐变发送按钮、品牌化头部。
- **底部导航**：悬浮胶囊（Pill）Tab Bar，激活项品牌渐变实心，统一 5 个 Tab。

## 版本号

- 应用版本号统一更新为 **1.4.0**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082000 + versionName 同步）。

## 校验

- 修改的 7 个文件（tailwind.config / index.css / Layout / Home / KBList / Search / Chat）经 Vite 全量打包校验通过。
