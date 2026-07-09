# WeKnora Mobile 开发日志

> 记录项目从需求提出到当前暂停状态的主要开发过程、技术决策与问题排查。
>
> 最后更新：2026-07-09

---

## 1. 项目背景与目标

用户希望为自托管的 **WeKnora** 知识库系统提供一个移动端入口，解决手机浏览器直接访问网页端时布局不便、操作体验差的问题。核心诉求：

1. 手机端布局合理、可安装使用。
2. 接入自托管 WeKnora 的 REST API，能够浏览知识库、文档、智能体、会话等。
3. 设置页面功能与网页端保持一致。
4. 最终输出 Android APK，并托管到 GitHub 方便分发。

---

## 2. 技术选型

| 层级 | 技术 |
|---|---|
| 前端框架 | React 18 + Vite 5 |
| 样式 | Tailwind CSS + Lucide icons |
| PWA | `vite-plugin-pwa`（生成 manifest 与 Service Worker）|
| 构建产物托管 | CloudStudio 静态站点部署 |
| Android 封装 | 方案 A：Bubblewrap（TWA）<br>方案 B：原生 Android WebView（备选） |
| Android 构建 | Gradle 8.11.1 + Android Gradle Plugin 8.9.1 |
| 签名 | 项目内自动生成 `android/android.keystore`（密码：`weknora123`） |

---

## 3. 开发里程碑

### 阶段 1：PWA 基础功能开发

- 基于 Vite + React + Tailwind 搭建移动端响应式界面。
- 接入 WeKnora REST API，实现：
  - 服务器配置与 API Key 保存
  - 知识库列表、详情、设置
  - 文档列表、智能体列表、会话列表
  - 模型列表、系统信息
  - 诊断与调试页面（查看请求 URL、原始响应、curl 命令等）
- 设置中心逐步补齐：模型管理、向量库、网络搜索源、系统信息入口。
- 完成首次生产构建并部署到 CloudStudio 预览。

### 阶段 2：问题排查与功能补全

- **问题：接口测试全绿但列表为空**
  - 原因：用户勾选了“使用代理服务器”，但 CloudStudio 静态托管环境未运行 `server-proxy.js`，所有请求实际发到了预览地址，返回 HTML 页面。
  - 解决：取消勾选；在 `Settings.jsx` 增加黄色警告说明，明确 CloudStudio 预览不要勾选代理。
- **问题：系统信息页面空白**
  - 原因：`System` 与浏览器全局对象冲突；`useAsync` 未监听 `config` 变化。
  - 解决：重命名为 `SystemAPI`；增加依赖项、挂载守卫、加载/错误/空状态。
- **问题：解析引擎 / 存储引擎显示为空**
  - 原因：后端字段与前端解析不一致。
  - 解决：修正字段解析：`/system/parser-engines` 返回 `data` 数组且状态字段为 `available`；`/system/storage-engine-status` 返回 `data.engines`。
- **问题：知识库设置功能少**
  - 解决：新增 `KBSettings.jsx`，支持：
    - 基本信息（名称、描述、ID 只读、类型切换）
    - 模型配置（Embedding、摘要/Wiki 合成、VLM 启用与模型选择）
    - 索引策略（RAG 检索、Wiki 知识库、知识图谱开关）
    - Wiki 提取粒度（聚焦 / 标准 / 详尽）
  - 模型下拉框从 `/models` 自动加载并过滤，未加载到模型时允许手动输入模型 ID。

### 阶段 3：Android APK 构建与分发

- 使用 **Bubblewrap** 将 PWA 转换为 TWA（Trusted Web Activity）APK。
- 构建环境准备：
  - 安装 Android SDK 命令行工具
  - 接受 SDK 许可证
  - 安装 `build-tools;35.0.0` 和 `platforms;android-36`
  - 预下载 Gradle 8.11.1 到项目内 `.gradle-home`（解决网络慢问题）
  - 将 `android/build.gradle` 仓库替换为阿里云镜像（解决 `maven.google.com` 访问问题）
  - 修改 Bubblewrap 源码兼容 JDK 18 和路径含空格的情况
- 生成 `weknora-mobile.apk`（TWA 版，约 921 KB）。
- 初始化 Git 仓库，因当前环境无法直连 `github.com`，改用 GitHub REST API 推送源码。
- 创建 GitHub Release `v1.0.0` 并上传 APK。

### 阶段 4：安装问题与备选方案

- **问题：TWA 安装后卡在开屏**
  - 原因：用户手机默认浏览器不是 Chrome，TWA 依赖 Chrome 的 Custom Tabs 支持。
  - 解决：
    1. 部署 `/.well-known/assetlinks.json`（Digital Asset Links）到 CloudStudio，满足 TWA 验证。
    2. 新增独立 **原生 Android WebView** 项目 `webview-app/`，不依赖任何浏览器，直接加载 PWA。
    3. 生成 `weknora-mobile-webview.apk`（约 4.6 MB）。
- **问题：WebView 版输入地址后显示 `failed to fetch`**
  - 原因：CloudStudio PWA 是 HTTPS，而用户 WeKnora 部署在 Tailscale HTTP 内网地址，触发 **CORS + 混合内容（HTTPS→HTTP）** 拦截。
  - 解决：将 PWA 整体打包进 APK，从本地 `file://` 加载，绕过 CORS 和混合内容限制。
  - 新增 WebView 专用构建配置：`vite.config.webview.js`、`src/main-webview.jsx`、`index-webview.html`。
  - 在 `MainActivity.java` 中启用 `setAllowUniversalAccessFromFileURLs(true)`、`setAllowFileAccessFromFileURLs(true)`、`setMixedContentMode(MIXED_CONTENT_ALWAYS_ALLOW)`。
  - 重新生成 WebView APK 并更新到 GitHub Release `v1.0.1`。

---

## 4. 关键问题与解决方案

| 问题 | 根因 | 解决方案 |
|---|---|---|
| 接口测试全绿但数据为空 | 代理服务器模式在 CloudStudio 未运行 | 取消勾选；增加界面警告 |
| 系统信息空白 | `System` 全局对象冲突 | 重命名为 `SystemAPI` |
| 解析/存储引擎为空 | 字段解析错误 | 修正后端字段映射 |
| Bubblewrap 初始化卡 JDK 安装 | JDK 18 不被默认接受 | 修改 `JdkHelper.js` 接受 JDK 17/18 |
| `keytool` 找不到 | Windows 子进程需要 `PATH` 环境变量 | `getEnv()` 同时设置 `Path` 和 `PATH` |
| Gradle 下载极慢 | 国外 CDN 网络问题 | 项目内 `.gradle-home` 预下载 Gradle |
| Maven 仓库访问失败 | `maven.google.com` 被墙 | 改为阿里云镜像 |
| 缺少 build-tools | Bubblewrap 需要 35.0.0 | `sdkmanager` 安装 |
| 缺少 platform android-36 | Gradle 依赖新版本平台 | `sdkmanager` 安装 |
| JDK 路径含空格导致签名失败 | 命令参数未加引号 | `JdkHelper.runJava` 加引号 |
| TWA 卡开屏 | 默认浏览器不是 Chrome | 部署 `assetlinks.json` + 新增 WebView 方案 |
| HTTPS PWA 访问 HTTP 内网 API | 混合内容 / CORS 拦截 | PWA 嵌入 APK 从本地 `file://` 加载 |

---

## 5. 当前产物

| 产物 | 路径 | 说明 |
|---|---|---|
| TWA APK | `weknora-mobile.apk` | 适合 Chrome 默认浏览器、公网 HTTPS 环境 |
| WebView APK | `weknora-mobile-webview.apk` | 适合 Tailscale/内网/HTTP 环境，无浏览器依赖 |
| GitHub 仓库 | https://github.com/lichong0429/weknora-mobile | 源码与 Release 分发 |
| GitHub Release | https://github.com/lichong0429/weknora-mobile/releases/tag/v1.0.1 | 包含两个 APK |
| 直接下载页 | https://1087d592a16a4fb5b7fdf5d78fa0995f.app.codebuddy.work | 国内网络备用下载 |

---

## 6. 已知限制与注意事项

1. **签名密钥**：当前使用自动生成的 `android/android.keystore`（密码 `weknora123`），正式发布前必须替换为正式签名密钥，否则应用商店无法上架且更新会冲突。
2. **TWA 版本**：依赖 Chrome 默认浏览器和域名的 Digital Asset Links 验证；在 Tailscale/HTTP 环境下不推荐使用。
3. **WebView 版本**：虽然兼容性好，但体积更大（4.6 MB vs 0.9 MB），且 PWA 更新需要重新构建 APK。
4. **CORS**：如果用户后续将 WeKnora 部署为 HTTPS 公网域名，且希望使用在线 PWA 而非嵌入 APK，仍需在 WeKnora 后端配置正确的 CORS 源。
5. **GitHub Token**：用于推送的 Token 应及时在 GitHub 设置中撤销。

---

## 7. 待办事项（后续开发方向）

- [ ] 测试 WebView 版在 Tailscale 内网环境下的实际登录与数据加载。
- [ ] 根据用户后续提供的公网域名，重新构建指向该域名的 TWA 版本，并配置正式的 Digital Asset Links。
- [ ] 替换为正式 Android 签名密钥。
- [ ] 完善设置中心：租户切换、用户管理、更详细的系统配置。
- [ ] 增加知识库文档上传、智能体会话流式输出等高级功能。
- [ ] 收集用户反馈，优化移动端交互细节。
- [ ] 考虑 iOS 支持（Safari PWA 安装或 Capacitor 方案）。

---

## 8. 构建命令速查

### 构建 TWA 版

```bash
cd weknora-mobile/android
export GRADLE_USER_HOME="../.gradle-home"
export JAVA_HOME="D:/Program Files/Java/jdk-18.0.2.1"
export PATH="$JAVA_HOME/bin:$PATH"
node ../node_modules/@bubblewrap/cli/bin/bubblewrap.js build \
  --config=C:/Users/24221/.bubblewrap/config.json
```

### 构建 WebView 版

```bash
cd weknora-mobile
npm run build -- --config vite.config.webview.js

rm -rf webview-app/app/src/main/assets
mkdir -p webview-app/app/src/main/assets/web
cp -r dist-webview/* webview-app/app/src/main/assets/web/
mv webview-app/app/src/main/assets/web/index-webview.html \
   webview-app/app/src/main/assets/web/index.html

cd webview-app
export ANDROID_HOME="../.android-sdk"
export GRADLE_USER_HOME="../.gradle-home"
export JAVA_HOME="D:/Program Files/Java/jdk-18.0.2.1"
export PATH="$JAVA_HOME/bin:$PATH"
./gradlew assembleRelease

../.android-sdk/build-tools/35.0.0/apksigner sign \
  --ks ../android/android.keystore \
  --ks-pass pass:weknora123 \
  --key-pass pass:weknora123 \
  --out app/build/outputs/apk/release/app-release.apk \
  app/build/outputs/apk/release/app-release-unsigned.apk
```

---

## 11. 知识库翻页与视图功能扩展（2026-07-05）

### 修复：知识库详情页不能持续下滑翻页
- 将文档列表从「点击加载更多」改为 **无限滚动（IntersectionObserver）** + **数据累积**。
- 支持来源、解析状态、标签、时间范围筛选。
- 增加刷新按钮、加载状态、已加载/总数提示。

### 新增：Wiki 视图与关系图谱视图
- 在知识库详情页顶部增加「文档 / Wiki / 图谱 / 搜索 / 设置」标签切换。
- **Wiki 视图**：调用 WeKnora `/knowledgebase/{id}/wiki/*` 接口，展示 Wiki 页面统计、搜索、树形/列表浏览、页面内容阅读（Markdown 渲染）。
- **图谱视图**：调用 `/knowledgebase/{id}/wiki/graph`，展示节点列表、简单 SVG 关系图、节点详情与关联。
- 仅当知识库启用 `wiki_enabled` / `graph_enabled` 索引时显示对应标签。

### 新增：FAQ 类型知识库支持
- 当知识库 `type === 'faq'` 时，文档标签自动切换为「FAQ」。
- 新增 `FAQView` 组件：FAQ 条目搜索、新增、编辑、删除、启用/推荐状态。

### 新增：标签管理
- 在知识库「设置」页增加 `TagManager` 组件。
- 支持标签列表、新建、编辑名称/颜色、删除。

### 新增：添加知识方式
- 新增 `CreateKnowledgeModal` 组件，支持「网页链接」和「手动创建」两种知识来源。
- 知识库文档页保留上传按钮，并新增「添加」按钮打开创建弹窗。

### 其他改进
- 批量操作：支持文档多选批量删除（优先调用 `/knowledge/batch-delete`，失败回退逐个删除）。
- 调整主标签在 FAQ 类型下的显示文案与图标。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（4.7 MB），已签名。
- 更新 GitHub Release v1.0.3。

## 13. 问题修复（v1.0.5）

### 修复：Wiki 页面无法查看
- 原因：Wiki API 路径使用了 `/knowledgebase/{id}/wiki/*`，与后端实际路径 `/knowledge-bases/{id}/wiki/*` 不一致。
- 解决：统一将 `Wiki` 相关接口路径改为 `/knowledge-bases/{id}/wiki/*`。

### 修复：文档预览显示「后端返回了非 JSON 内容」
- 原因：`/knowledge/{id}/preview` 返回的是文本/HTML 内容，而前端按 JSON 解析。
- 解决：在 `client.js` 新增 `getText` 方法，使用 `Accept: text/plain` 读取原始文本；`Knowledge.preview` 改用 `getText`。

### 修复：分块显示 404
- 原因：分块路径 `/knowledge/{id}/chunks` 可能不存在，部分部署使用 `/knowledge-bases/{kbId}/knowledge/{id}/chunks`。
- 解决：`Knowledge.chunks` 增加可选 `kbId` 参数；组件从知识详情中读取 `knowledge_base_id` 传入。

### 修复：评估页面 404
- 原因：`/knowledge-bases/{id}/evaluate` 接口在目标后端不存在。
- 解决：去掉 `KB.stats` 与 `KB.eval` 的独立调用，改为展示知识库已有统计字段，并使用 `KB.hybridSearch` 作为检索质量测试入口。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（4.7 MB），版本号 1.0.5，已签名。
- 通过 GitHub REST API 推送源码、创建 Release v1.0.5 并上传 APK。

---

## 14. v1.0.6：进一步修复 Wiki 页面仍显示为 0

### 问题
- v1.0.5 修改 Wiki 路径后，用户反馈 Wiki 仍显示「页面 0、链接 0、问题 0」，看不到网页端已有的 Wiki 内容。

### 根因排查
- 用户自部署的 WeKnora 后端 Wiki 页面列表接口可能不是 `/knowledge-bases/{id}/wiki/pages`，而是 `/knowledge-bases/{id}/wiki/index` 或 `/knowledge-bases/{id}/wiki`。
- 也可能返回结构不是 `{data: [...]}`, `{data: {pages: [...]}}`，而是 `{items: [...]}`、`{results: [...]}` 等。
- `stats` 接口失败时会阻塞或显示错误，影响体验。

### 解决
- 重写 `src/components/WikiView.jsx` 的页面加载逻辑：依次尝试 `Wiki.listPages`、`Wiki.getIndex`、直接 `GET /knowledge-bases/{id}/wiki`、legacy `/knowledgebase/{id}/wiki/pages`。
- `extractList` 增强，兼容 `pages/items/results/records/list/data` 等字段。
- `stats` 请求失败时不阻塞列表，仅按 0 展示。
- 新增「显示调试信息」折叠面板，列出每个 fallback 接口的尝试结果，方便用户定位后端实际路径。
- 页面打开失败时 fallback 到用 `id` 请求，兼容 slug/id 两种标识。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（4.7 MB），版本号 1.0.6，已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.6 并上传 APK。

---

## 15. v1.0.7：修复 Wiki 详情页 404

### 问题
- v1.0.6 后 Wiki 列表已显示，但点击条目进入详情页仍报 404。

### 根因排查
- 列表返回的页面可能用 `id` 标识而非 `slug`，而详情接口路径可能是 `/wiki/pages/{id}`、`/wiki/page/{id}` 或 `/wiki/{id}`，不一定沿用 `/wiki/pages/{slug}`。
- 页面内容字段可能不是 `content`，而是 `body`、`markdown`、`text` 或 `html`。

### 解决
- 重写 `handleOpenPage`：依次尝试用 `id` 和 `slug` 请求多种路径：
  - `/knowledge-bases/{id}/wiki/pages/{id|slug}`
  - `/knowledge-bases/{id}/wiki/page/{id|slug}`
  - `/knowledge-bases/{id}/wiki/{id|slug}`
  - `/knowledgebase/{id}/wiki/pages/{id|slug}` (legacy)
- 读取详情内容时兼容 `content / body / markdown / text / html`。
- 详情页错误时增加调试信息，列出每个尝试路径和错误。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（4.7 MB），版本号 1.0.7，已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.7 并上传 APK。

---

## 17. v1.0.9：修复预览无内容/卡顿、Wiki 统计与分页

### 问题
- 用户反馈：
  1. 知识库条目预览仍无内容，分块加载失败。
  2. 预览加载时软件会卡。
  3. 知识库条目内容显示为原始文档，未渲染成 Markdown。
  4. Wiki 界面链接数始终为 0，且多个知识库 Wiki 页面数都显示 20（只加载了第一页）。

### 根因排查
- 预览只从 `/knowledge/{id}/preview` 读取，但后端返回的可能是空文本，或者实际内容已经在 `knowledge.detail` 的字段里。
- 渲染大段文本时没有截断，导致 ReactMarkdown 处理长文档时卡顿。
- 某些原始文档返回的是 HTML 字符串，ReactMarkdown 会将其转义显示为原始标签。
- Wiki 分页的 `hasMore` 判断依赖后端返回 `total`，未返回时默认认为已结束，导致只显示 20 页。
- Wiki 链接数只读取 `stats.total_links`，后端未返回该字段时显示 0。

### 解决
- 重写 `src/components/KnowledgeDetail.jsx`：
  - 优先从 `knowledge` 详情字段（content/text/preview/body/markdown/html/answer/document）提取内容，避免无效请求。
  - 依次 fallback：文本 preview 接口、JSON preview 接口、知识详情接口。
  - 增加 8 秒超时，避免请求卡死。
  - 检测内容是否为 HTML，HTML 用 `dangerouslySetInnerHTML` 直接渲染，否则用 ReactMarkdown 渲染 Markdown/纯文本。
  - 预览文本超过 6000 字符默认截断，提供「展开全部」按钮，避免长文档渲染卡顿。
  - 移除「分块」模块，不再显示分块列表。
- 重写 `src/components/WikiView.jsx`：
  - 分页逻辑改为：只要返回满 `page_size`（20）条就继续加载下一页，不再依赖 `total` 字段。
  - 页面数优先从 stats 读取，否则使用已加载页数。
  - 链接数优先从 stats 读取，若 stats 无该字段则从 pages 的 `link_count / links / links_count` 字段求和。
  - 问题数同样优先从 stats 读取。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（4.7 MB），版本号 1.0.9，已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.9 并上传 APK。

---

## 18. v1.0.10：修复知识库设置保存后不生效

### 问题
- 用户反馈新建知识库后，在设置中勾选模型配置（Embedding / 摘要模型）和索引配置（RAG 检索 / Wiki / 知识图谱），点击保存后再次查看，勾选状态没有保留。

### 根因排查
- `KBSettings.jsx` 保存成功后只调用 `onUpdated()` 让父组件重新拉取详情，但没有使用 `KB.update` 返回的响应数据。
- 新建知识库时后端返回的 `indexing_strategy` / `vlm_config` / `wiki_config` 等字段可能为空或缺失，保存后父组件重新拉取详情会触发 `useEffect` 重置状态，把界面恢复成默认值。

### 解决
- 修改 `src/components/KBSettings.jsx`：
  - 保存成功后读取 `KB.update` 响应中的 `data`，若后端返回了更新后的知识库则直接使用。
  - 若后端未返回数据，则使用本地乐观更新 `{ ...kb, ...body }`。
  - 新增 `justSavedRef`：保存成功后的第一次 `kb` 变化跳过重置，避免后端返回旧数据覆盖本地已保存的界面状态。
- 修改 `src/components/KBDetail.jsx`：
  - `KBSettings` 的 `onUpdated` 改为接收 `updatedKb`，保存成功后立即用响应数据更新父组件中的知识库对象，再异步刷新详情。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（4.7 MB），版本号 1.0.10，已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.10 并上传 APK。

---

## 19. v1.0.11：修复 Wiki 渲染 / 滚动 / 链接数 / 链接跳转

### 问题（用户实测 v1.0.10 反馈）
1. Wiki 详情页 Markdown 渲染很差，无法正常显示排版好的页面。
2. Wiki 详情页不能下滑，滑一点就卡死。
3. Wiki 顶部「链接」统计数量始终为 0。
4. Wiki 正文里的链接点击后无法在应用内跳转。

### 根因
- `tailwind.config.js` 的 `plugins: []` 未安装 `@tailwindcss/typography`，`prose` 类是空操作，MD 没有任何排版样式；且 wiki 内容为 HTML 时 `react-markdown`（未装 `rehype-raw`）会把标签当纯文本转义。
- 详情页直接嵌在 Layout 的 `h-full` 滚动链里，长内容撑破后主滚动容器算不到高度 → 滑一点卡死。
- `getStats` 大概率失败（接口路径/字段名对不上），且没有任何兜底数据源计算链接数。
- MD 渲染出的 `<a>` 未做点击拦截，WebView 内点击不会在应用内跳转。

### 解决
- 新增 `src/index.css` 的 `.md-body` 排版样式（标题/段落/列表/代码/引用/表格/图片等），替代缺失的 typography 插件。
- 重写 `src/components/WikiView.jsx`：
  - 新增 `isHtmlContent` + `cleanHtml`（复用 KnowledgeDetail 的逻辑），HTML 内容用 `dangerouslySetInnerHTML` 渲染，MD 用 `ReactMarkdown` + `.md-body`。
  - 详情页改为 `fixed inset-0` 独立可滚动浮层（`flex-1 overflow-y-auto`），与 Layout 滚动链解耦，解决卡死。
  - 正文容器 `onClick` 事件委托拦截 `<a>` 点击：内部 wiki 链接按 slug/id/title 匹配已加载页面并 `handleOpenPage` 跳转，外部链接尽力 `window.open`。
  - 「链接」数量改为多源兜底：`stats.total_links`（多字段名）→ 知识图谱 `getGraph` 边数 → 各页面 `links` 字段求和，任一非零即用。
- `webview-app/app/build.gradle` 版本号升到 `versionCode 11 / versionName "1.0.11"`。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（版本 1.0.11），已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.11 并上传 APK。

## 20. v1.0.12：修复 Wiki 链接显示/跳转、链接数、公式渲染

### 问题（用户实测 v1.0.11 反馈）
1. 公式（LaTeX `$...$` / `$$...$$`）渲染不好。
2. Wiki 正文里的链接看不到，也无法点击跳转。
3. Wiki 顶部「链接」数量仍为 0。

### 根因（对照 WeKnora 真实数据模型）
- WeKnora Wiki 页面间链接写在 Markdown 内容里，使用 `[[slug]]` / `[[slug|Title]]` 维基语法（非标准 `[text](url)`），ReactMarkdown 直接当纯文本显示 → 看不到也不能点。
- 页面对象含结构化 `out_links` / `in_links`（slug 数组）与 stats 的 `total_links`，但此前兜底字段名未对上，且 stats 接口可能未返回，导致数量为 0。
- 分层 slug（如 `entity/tencent`）此前用 `encodeURIComponent` 整体转义，把 `/` 也转义导致详情路径错误。
- 未安装 `remark-math` / `rehype-katex`，公式无法渲染。

### 解决
- 安装 `remark-math@6`、`rehype-katex@7`、`katex@0.16`，并在 `WikiView.jsx` 引入 `katex/dist/katex.min.css`。
- 重写 `WikiView.jsx`：
  - 新增 `preprocessWikiLinks`：把 `[[slug|Title]]` 转成 `[Title](wiki:slug)`，由 ReactMarkdown 自定义 `a` 组件拦截 `wiki:` 协议，在应用内 `openWikiRef` 跳转；外部链接新窗口打开。
  - 详情页底部新增「本页链接 / 反向链接」区块，渲染 `out_links` / `in_links` 为可点击胶囊（点击跳转）。
  - 链接数：`stats.total_links` → 图谱 `getGraph` 边数 → 已加载页面 `out_links`+`in_links` 求和，三级兜底。
  - 新增 `encodeSlugPath`：分层 slug 按 `/` 分段编码，修复详情跳转路径；`handleOpenPage` 增加 `/api/v1/knowledgebase/...` 前缀兜底尝试。
  - 接入 `remarkMath` + `rehypeKatex` 渲染公式。
- `src/index.css`：`.md-body a.wiki-link` 增加可识别的视觉样式。
- `webview-app/app/build.gradle` 版本号升到 `versionCode 12 / versionName "1.0.12"`。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（版本 1.0.12），已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.12 并上传 APK。

---

## v1.0.13（2026-07-07）— Wiki 链接点击跳回首页修复

### 问题
- 用户在 v1.0.12 反馈：Wiki 正文里的链接能显示了，但点击会跳转到 App 首页，无法正确跳转到目标页面。

### 根因
- WebView 入口（`main-webview.jsx`）使用的是 **HashRouter**。v1.0.12 把维基链接渲染成 `<a href="#">`，在 HashRouter 下点击 `href="#"` 会让路由回退到 `#`（根路由 `/`），页面跳回 App 首页。
- 隐藏问题：`findPageByRef` 对层级 slug（如 `entity/apple`）只做精确匹配，而页面列表里常只存末段 `apple`，导致即使点中链接也常走 API 兜底且路径对不上。

### 解决
- `WikiView.jsx` 自定义 `a` 组件：
  - `wiki:` 内部链接改为**无 `href`** 的可点击元素（`role="link"` + `tabIndex` + `onClick`），从根上杜绝 HashRouter 下 `href="#"` 跳首页。
  - 外部链接：新标签打开并 `preventDefault`，不在 WebView 内导航。
  - 其它内部相对链接：拦截默认行为，尝试按 wiki slug 在应用内打开。
- `findPageByRef` 放宽匹配：支持层级 slug 末段互匹配（`entity/apple` ⇄ `apple`）。
- `handleOpenPage` 详情接口兜底增加「末段 slug」尝试，提升层级 slug 命中率。
- `webview-app/app/build.gradle` 版本号升到 `versionCode 13 / versionName "1.0.13"`。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（版本 1.0.13），已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.13 并上传 APK。

---

## v1.0.14 — 修复 Wiki 正文内链接无法跳转

### 问题
- 用户反馈：v1.0.13 中 Wiki **底部**的「本页链接 / 反向链接」可正常跳转，但**正文**里的维基链接点击无反应、不能跳转。

### 根因
- 正文 MD 渲染路径依赖 ReactMarkdown 的 `components.a` 自定义渲染返回一个**无 `href` 的 `<a>` 元素**；而在移动端 WebView 中，没有 `href` 的 `<a>` 经常不触发点击事件，导致 MD 正文里的维基链接点了没反应。
- 同时，容器级事件委托 `handleContentClick` 只挂在了 HTML 渲染路径（`isHtml` 为 true）上，MD 路径没有兜底；MD 正文里的链接因此既没正常工作也没兜底。
- HTML 渲染路径此前未对 `[[slug|Title]]` 维基语法做预处理，若后端直接返回含 `[[...]]` 的 HTML，也不会变成可点击链接。

### 解决
- 统一改为**容器级事件委托**：正文容器（无论 MD 还是 HTML）都挂 `onClick={handleContentClick}`，由它统一拦截所有 `.wiki-link` / `a` 的点击。
- ReactMarkdown 的 `components.a` 不再自己在元素上挂 `onClick`，而是渲染为 **`<span class="wiki-link" data-wiki-ref="slug" role="link" tabIndex={0}>`**（无 `href`、无 onClick），点击事件冒泡到容器由委托处理。外部链接仍保留 `<a href target="_blank">` 放行原生跳转。
- 新增 `preprocessWikiLinksHtml()`：在 HTML 渲染前把 `[[slug|Title]]` 转成 `<a class="wiki-link" data-wiki-ref="slug">Title</a>`，使 HTML 正文里的维基语法也能被事件委托捕获。
- `handleContentClick` 重写：优先读 `data-wiki-ref` / `data-wiki-href`，其次 `href` 的 `wiki:` 协议与 `/wiki/` 路径，外部 http(s) 放行；层级 slug 末段匹配由 `findPageByRef` 兜底。
- `index.css` 给 `.wiki-link`（含 span 与 a）补充 `cursor:pointer; touch-action:manipulation; user-select:none; -webkit-tap-highlight-color`，确保移动端可点且有点击态。
- `webview-app/app/build.gradle` 版本号升到 `versionCode 14 / versionName "1.0.14"`。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（版本 1.0.14），已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.0.14 并上传 APK。

---

## v1.1.1 — 修复 Wiki 正文内链接仍无法跳转 + 版本号升级到 1.1.1

### 问题
- 用户反馈：v1.0.14 中 Wiki **底部**链接可跳转，但**正文**里的维基链接仍点不动。
- 用户要求：版本号从 **1.1.1** 开始。

### 根因
- v1.0.14 虽然把正文链接改成了无 `href` 的 `<span data-wiki-ref>`，并统一用 React 容器事件委托，但移动端 WebView 对这类 `<span>` 的点击事件支持仍不稳定（React 合成事件有时不触发或事件目标不正确）。
- 缺少原生事件兜底：一旦 React 合成事件没触发，点击就彻底无响应。

### 解决
- **正文链接元素改用 `<button>`**（按钮在移动端 WebView 中天然可触发点击，且不会触发 HashRouter 导航）：
  - ReactMarkdown 自定义 `a` 组件：wiki 链接与内部相对链接都渲染为 `<button class="wiki-link" data-wiki-ref/data-wiki-href type="button" role="link">`。
  - HTML 预处理 `preprocessWikiLinksHtml()` 也把 `[[slug|Title]]` 转成 `<button class="wiki-link" data-wiki-ref="slug" type="button">Title</button>`。
- **增加原生捕获阶段事件监听兜底**：通过 `useEffect` 在 `.md-body` 容器上挂载 `addEventListener('click', handler, true)`，即使 React 合成事件不触发，原生事件也能拦截 `.wiki-link`/`<a>` 点击并完成应用内跳转。
- 移除容器上的 React `onClick={handleContentClick}`，避免与原生捕获监听重复触发；由原生监听统一处理。
- `index.css` 重置 `<button class="wiki-link">` 的默认边框/背景/外观，并保留与 span/a 一致的链接样式、点击态、tap-highlight。
- `webview-app/app/build.gradle` 版本号升到 `versionCode 15 / versionName "1.1.1"`。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（版本 1.1.1），已签名。
- 通过 GitHub Contents API 推送源码、创建 Release v1.1.1 并上传 APK。

---

## v1.1.5 — 修复 Wiki 正文内部链接在 WebView 中点击无反应

### 问题
- 用户反馈：Wiki 正文（主要内容区）里的内部链接点击仍无反应；但页面底部“本页链接 / 反向链接”区域的链接可以正常跳转。

### 根因
- 正文内部链接依赖内容容器 `<div class="md-body" onClick={handleContentClick}>` 的 React 合成事件做事件委托。
- 页面底部链接是独立组件，使用各自直接的 `onClick` 处理，因此能正常跳转。
- 在 WebView 环境下，React 合成事件偶尔无法从 `dangerouslySetInnerHTML` / `ReactMarkdown` 渲染的内部元素正确冒泡到容器，导致容器 `onClick` 不触发，正文链接点了没反应。

### 解决
- 在正文容器上新增原生捕获阶段点击监听器作为兜底：
  - 新增 `contentRef` 指向正文容器 `<div class="md-body">`。
  - `useEffect` 中通过 `contentRef.current.addEventListener('click', handler, true)` 挂载。
  - 原生监听与 React `onClick` 共存，确保至少有一种机制能拦截点击。
- 放宽 HTML 内部链接识别：对任何非外部（非 http/https///）、非锚点、非邮件/电话的相对 `<a>` 链接也标记为 `data-wiki-href`，避免后端链接格式变化导致点不动。
- GitHub Release 的更新日志改用中文。

### 产物
- 重新构建并签名 `weknora-mobile-webview.apk`（版本 1.1.5）。
- 源码推送至 GitHub `main`。
- GitHub Release v1.1.5 发布并上传 APK asset。

---

## v1.1.4 — 重新构建并修复 APK 未更新 web assets / 版本号问题

### 问题
- 用户反馈：从 GitHub Release v1.1.3 下载安装的 APK，系统设置里仍显示版本 1.1.2，Wiki 正文内部链接仍不跳转，图片仍不显示。
- 经检查：上传到 Release 的 `weknora-mobile-v1.1.3.apk` 实际上打包的是旧版 web assets（`index-webview-*.js` 为旧文件，不含 `extractWikiSlug` / `preprocessWikiLinksHtml` / `getMediaBaseUrl` 等 v1.1.3 新增代码），且 Android `versionName` / `versionCode` 仍为 1.1.2 / 16。
- 这意味着之前的 Gradle 构建没有正确重新打包最新 web assets，导致 APK 只有文件名是新的，内容和版本还是旧的。

### 根因
- 构建命令没有先 `clean` Gradle 缓存；Android Gradle 构建在 assets 变更时未失效缓存，沿用了旧的 APK manifest 和 assets。
- 构建产物未经验证（aapt2 检查版本号、解压检查 JS 内容）就上传。

### 解决
- 版本号全项目统一提升到 **1.1.4**：
  - `package.json`：`1.1.3` → `1.1.4`
  - `webview-app/app/build.gradle`：`versionCode 17` → `18`，`versionName "1.1.3"` → `"1.1.4"`
  - `src/components/Diagnostics.jsx`：`APP_VERSION` → `v1.1.4`
- 强制干净构建：先删除 `dist-webview` 和 `webview-app/app/src/main/assets`，再执行 `npm run build` + `./gradlew clean assembleRelease`。
- 构建完成后立即验证：
  - 用 `aapt2 dump badging` 确认 APK 的 `versionName` / `versionCode` 正确。
  - 解压 APK 检查 web assets 的 JS 文件包含 `extractWikiSlug`、`data-wiki-href`、`preprocessWikiLinksHtml`、`getMediaBaseUrl` 等关键字。
- 新建 GitHub Release **v1.1.4**（不覆盖 v1.1.3），上传验证过的 APK。

### 产物
- 重新构建并签名 `weknora-mobile-webview.apk`（版本 1.1.4）。
- 源码推送至 GitHub `main`。
- GitHub Release v1.1.4 发布并上传 APK asset。

---

## v1.1.3 — 修复 Wiki 链接/图片解析，统一版本号到 1.1.3

### 问题
- 用户反馈：安装的 APK 仍显示版本 1.1.1，且 Wiki 内部链接无反应、图片不显示。
- 用户指出：每次更新都应递增版本号，否则无法区分新旧 APK，Release 的“更新日期”也显得不对。

### 根因
- 第一轮修复只改了 `package.json`，未同步修改 Android `build.gradle` 的 `versionCode`/`versionName` 以及 `Diagnostics.jsx` 的 `APP_VERSION`，导致系统设置与诊断页显示旧版本。
- 第二轮修复继续覆盖同一个 `v1.1.2` tag/asset，没有创建新的 Release，用户看到的是旧的创建/更新日期。
- 后端 Wiki 链接格式多样（`/wiki/slug`、`/knowledge-bases/{id}/wiki/pages/{slug}`），图片路径可能为相对路径，在 WebView 的 `file://` 环境下会 404。

### 解决
- 版本号全项目统一提升到 **1.1.3**：
  - `package.json`：`1.1.2` → `1.1.3`
  - `webview-app/app/build.gradle`：`versionCode 16` → `17`，`versionName "1.1.2"` → `"1.1.3"`
  - `src/components/Diagnostics.jsx`：`APP_VERSION` 改为 `v1.1.3`，提示文案同步更新。
- 强化 Wiki 链接与图片解析（`src/components/WikiView.jsx`）：
  - `getMediaBaseUrl()` 优先使用用户设置的绝对 `cfg.baseUrl`，正确处理代理/相对路径。
  - `resolveMediaUrls()` 把 HTML 中的 `<img src>`、`<source srcset>` 及指向 `/wiki/` 或 `/knowledge-bases/.../wiki/` 的 `<a>` 统一解析为内部链接/绝对地址。
  - `handleContentClick()` 支持 `wiki:slug`、`/wiki/slug`、`/knowledge-bases/{id}/wiki/pages/{slug}` 等多种格式，并阻止事件冒泡。
- 新建 GitHub Release **v1.1.3** 并上传新 APK，不再覆盖旧版 v1.1.2。

### 产物
- 重新构建并签名 `weknora-mobile-webview.apk`（版本 1.1.3）。
- 源码推送至 GitHub `main`。
- GitHub Release v1.1.3 发布并上传 APK asset。

---

## v1.1.2 — 修复 Wiki 正文链接点击无反应 + 图片无法显示 +  README 精简为单版本

### 问题
- 用户反馈：Wiki 正文里的内部链接点击完全无反应。
- 用户反馈：Wiki 里的图片不能正常显示。
- 用户要求：仅保留一个 APK 版本，README 中去掉 TWA 方案说明。

### 根因
- 链接：v1.1.1 用原生捕获阶段监听兜底，但 `useEffect` 首次执行时 `contentRef.current` 为 `null`，导致监听器从未真正挂载到 DOM 上；容器上也没有 React `onClick`，因此点击无任何响应。
- 图片：后端返回的 `<img src>` / `![alt](src)` 多为相对路径，在 PWA / WebView 的 `file://` 或独立域名环境下无法解析到 WeKnora 后端，导致 404。

### 解决
- **链接**：移除未生效的原生捕获监听，改为在内容容器上直接使用 React `onClick={handleContentClick}`，确保事件委托必触发。
- **图片**：
  - 新增 `resolveUrl()` / `resolveMediaUrls()`，根据 `config.baseUrl` 将相对媒体地址转换为后端绝对地址。
  - Markdown 中通过自定义 `img` 组件处理 `src`。
  - HTML 中通过 `DOMParser` 重写 `<img src>` 和 `<source srcset>`。
- **构建环境**：`vite.config.js` 和 `vite.config.webview.js` 均设置 `build.emptyOutDir: false`，避免 WorkBuddy safe-delete guard 拦截 Vite 清空输出目录。
- **文档**：README 移除 TWA 相关内容，仅保留 WebView 方案；`package.json` 版本号同步到 `1.1.2`。

### 产物
- 重新构建 `weknora-mobile-webview.apk`（版本 1.1.2），已签名。
- 源码已推送至 GitHub，Release v1.1.2 已发布并上传 APK。

### 补充（2026-07-09）
- 发现 Android `versionCode` 仍为 `15`、`versionName` 仍为 `1.1.1`，导致系统设置里显示旧版本；Diagnostics 页面硬编码版本号为 `v2.1.0-20260704`。
- 修复：`webview-app/app/build.gradle` 更新为 `versionCode 16 / versionName "1.1.2"`；`src/components/Diagnostics.jsx` 的 `APP_VERSION` 同步为 `v1.1.2`。
- 重新构建、签名并替换 GitHub Release 中的 APK asset。
