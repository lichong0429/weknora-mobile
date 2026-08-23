<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.4.5

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.4.4...v1.4.5

## 修复

- **Wiki 页面内容显示不全（显示到某处就停，后面消失）**：
  - 根因一：`resolveMediaUrls` 原先用 `DOMParser` 全量解析 HTML 再取 `doc.body.innerHTML`，内容含畸形标签/裸 `</body>` 时会被浏览器容错解析截断，导致「显示到这里就停」。改为正则局部替换（只处理 img/srcset/a 的 URL），其余原文原样保留。
  - 根因二：`cleanHtml` 原先用贪婪正则删除 script/style/iframe，遇到未闭合标签会把后续全部正文误删。改为非贪婪匹配「最近的闭合标签」，未闭合时保留原文。
  - 同一缺陷也存在于条目预览页（KnowledgeDetail），已同步修复。
  - 新增内容完整性调试：Wiki 详情页开启调试后显示后端返回的原始字符数与渲染判定类型，便于区分「后端截断」与「前端渲染截断」。

## 版本号

- 应用版本号统一更新为 **1.4.5**（package.json / package-lock.json / 诊断页 APP_VERSION / APK versionCode 2026082400 + versionName 同步）。

## 校验

- cleanHtml 修复通过 5 项单元测试（未闭合 script 保留正文 / 闭合 script 删除 / 裸 </body> 不截断 / 数学小于号保留 / 正常 HTML 保留）。
- 前端（WikiView / KnowledgeDetail）经 Vite 全量打包校验通过。
