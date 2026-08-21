<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.4

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.3...v1.4.4

## 修复

- **输入法弹出遮挡输入框（根治）**：
  - Manifest 补充 `windowSoftInputMode="adjustResize"`。
  - 原生层 insets 监听加入 IME 键盘高度：键盘弹出时根布局自动增加底部 padding，输入框始终可见；输入框聚焦时前端再滚动对齐一次。
- **模型思考过程混入正文**：SSE 流式解析新增思考字段捕获（`reasoning_content` / `reasoning` / `thinking` / `thought`，兼容 DeepSeek/OpenAI 系与后端自定义字段），思考内容不再混入回答正文。
- **新增「思考过程」折叠块**：AI 回复中若含思考过程，显示为灰色折叠条（默认折叠），点击「展开」查看完整思考，超长内容限高滚动；历史消息已落库的思考字段同样识别。

## 版本号

- 应用版本号统一更新为 **1.4.4**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082111 + versionName 同步）。

## 校验

- 前端（Chat / Manifest / MainActivity）改动经 Vite 全量打包校验通过，CI 完成 APK 构建。
