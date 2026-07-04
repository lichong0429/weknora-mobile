# WeKnora Mobile

一个为 WeKnora 打造的移动端 PWA / TWA 应用，解决手机浏览器访问 WeKnora 网页布局不便的问题。

## 功能

- 连接自托管的 WeKnora REST API
- 知识库列表、详情、设置（模型、索引策略、Wiki 提取粒度等）
- 文档、智能体、会话、模型、系统信息浏览
- 诊断与调试页面，方便排查接口问题
- 响应式移动端布局
- 可封装为 Android APK（TWA）

## 技术栈

- React 18 + Vite 5
- Tailwind CSS + Lucide icons
- vite-plugin-pwa（生成 PWA manifest 与 Service Worker）
- Bubblewrap（PWA → TWA → APK）

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

## 签名密钥

项目已自动生成 `android/android.keystore`，默认密码为 `weknora123`。生产环境请替换为正式签名密钥。

## 注意事项

- 设置页面中的「使用代理服务器」仅在本地运行 `npm run start`（代理服务器）时有效。
- 在 CloudStudio 等静态托管环境直接部署 PWA 时，请关闭「使用代理服务器」。
- 系统信息页面依赖 `/system/info` 接口，若接口不存在会显示空状态。
