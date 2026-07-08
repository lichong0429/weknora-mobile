# WeKnora Mobile

一个为 WeKnora 打造的移动端 PWA / WebView APK 应用，解决手机浏览器访问 WeKnora 网页布局不便的问题。

## 功能

- 连接自托管的 WeKnora REST API
- 知识库列表、详情、设置（模型、索引策略、Wiki 提取粒度等）
- 知识库复制 / 移动
- 知识库统计与检索评估
- 知识库文档无限滚动、筛选、批量操作
- 知识库 Wiki 视图、关系图谱视图（需启用对应索引）
- FAQ 类型知识库条目管理
- 标签管理（新建、编辑、删除）
- 文档、网页链接、手动创建知识
- 文档、智能体、会话、模型、系统信息浏览
- 诊断与调试页面，方便排查接口问题
- 响应式移动端布局
- 可封装为 Android APK（原生 WebView 方案）

## 为什么使用 WebView APK

当前版本使用**原生 WebView** 将 PWA 打包进 APK，从本地 `file://` 加载：

- 不依赖手机默认浏览器是否是 Chrome。
- 可绕过 HTTPS→HTTP 的混合内容限制与跨域限制。
- 适合 Tailscale / 内网 / 自托管 HTTP 后端环境。

> 本项目不再维护 TWA（Trusted Web Activity）版本。如果你需要在线 PWA，可直接部署 `dist` 目录到支持 HTTPS 的静态托管。

## 技术栈

- React 18 + Vite 5
- Tailwind CSS + Lucide icons
- vite-plugin-pwa（生成 PWA manifest 与 Service Worker）
- 原生 Android WebView

## 本地开发

```bash
npm install
npm run dev
```

## 构建 PWA

```bash
npm run build
npm run preview
```

## 构建 Android APK

已配置本地 Android SDK。构建步骤如下：

1. 构建 WebView 专用 PWA：

```bash
npm run build -- --config vite.config.webview.js
```

2. 将构建产物复制到 Android 资源目录：

```bash
rm -rf webview-app/app/src/main/assets
mkdir -p webview-app/app/src/main/assets/web
cp -r dist-webview/* webview-app/app/src/main/assets/web/
mv webview-app/app/src/main/assets/web/index-webview.html \
   webview-app/app/src/main/assets/web/index.html
```

3. 构建并签名 APK：

```bash
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

产物为 `webview-app/app/build/outputs/apk/release/app-release.apk`。

## 签名密钥

项目已自动生成 `android/android.keystore`，默认密码为 `weknora123`。生产环境请替换为正式签名密钥。

## 注意事项

- 设置页面中的「使用代理服务器」仅在本地运行 `npm run start`（代理服务器）时有效。
- 在 CloudStudio 等静态托管环境直接部署 PWA 时，请关闭「使用代理服务器」。
- 系统信息页面依赖 `/system/info` 接口，若接口不存在会显示空状态。
