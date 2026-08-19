<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.3.1

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.3.0...v1.3.1

## 修复

- **构建稳定性**：Gradle 下载源改用腾讯云镜像（腾讯云 Maven / Google 镜像），规避 GitHub Services 503 导致的 Android APK 构建失败。

## 版本号

- 应用版本号统一更新为 **1.3.1**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026081923 + versionName 同步）。

## 校验

- 版本号改动经 esbuild 全量打包校验通过。
