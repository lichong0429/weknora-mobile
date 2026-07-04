# WeKnora Mobile

一个为 WeKnora 打造的移动端 PWA / TWA 应用，解决手机浏览器访问 WeKnora 网页布局不便的问题。

## 功能

- 连接自托管的 WeKnora REST API
- 知识库列表、详情、设置（模型、索引策略、Wiki 提取粒度等）
- 文档、智能体、会话、模型、系统信息浏览
- 诊断与调试页面，方便排查接口问题
- 响应式移动端布局
- 可封装为 Android APK（TWA 或 WebView 两种方案）

## 两个 APK 的区别

| APK | 技术方案 | 适用场景 | 依赖 |
|---|---|---|---|
| `weknora-mobile.apk` | TWA（Trusted Web Activity） | Chrome 是默认浏览器、且部署域名的 Digital Asset Links 已配置 | Chrome / 支持 TWA 的浏览器 |
| `weknora-mobile-webview.apk` | 原生 WebView（PWA 嵌入本地） | 默认浏览器不是 Chrome、内网/Tailscale 环境、需要绕过 CORS/混合内容限制 | 无浏览器依赖 |

如果 TWA 版本安装后一直卡在开屏，或者输入 WeKnora 地址后提示 `failed to fetch`，请使用 WebView 版本。WebView 版把 PWA 直接打包进 APK，从本地 `file://` 加载，可绕过 HTTPS→HTTP 的混合内容限制和跨域限制。

## 技术栈

- React 18 + Vite 5
- Tailwind CSS + Lucide icons
- vite-plugin-pwa（生成 PWA manifest 与 Service Worker）
- Bubblewrap（PWA → TWA → APK）
- 原生 Android WebView（备选方案）

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

已配置 Bubblewrap 与本地 Android SDK。在 `android/` 目录中运行：

```bash
node ../node_modules/@bubblewrap/cli/bin/bubblewrap.js build \
  --config=C:/Users/24221/.bubblewrap/config.json
```

APK 产物位于 `android/app-release-signed.apk`。

### WebView 备选 APK

如果 TWA 在你的手机上无法启动（如默认浏览器不是 Chrome），或者因 CORS / 混合内容导致连不上自托管的 WeKnora，可使用 WebView 版本。该版本把 PWA 打包进 APK，从本地加载，不依赖 CloudStudio 托管地址。

先构建 WebView 专用 PWA：

```bash
npm run build -- --config vite.config.webview.js
```

将构建产物复制到 Android 资源目录：

```bash
rm -rf webview-app/app/src/main/assets
mkdir -p webview-app/app/src/main/assets/web
cp -r dist-webview/* webview-app/app/src/main/assets/web/
mv webview-app/app/src/main/assets/web/index-webview.html \
   webview-app/app/src/main/assets/web/index.html
```

然后构建并签名 APK：

```bash
cd webview-app
export ANDROID_HOME="../.android-sdk"
export GRADLE_USER_HOME="../.gradle-home"
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
