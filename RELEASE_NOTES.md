<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.7.5

发布日期：2026-09-29

**修复**：正文里的图片一直显示不出来（文档预览、wiki 正文、问答回答三处都受影响）。根因是渲染层把 WeKnora 内部存储协议的图片地址整个清空了。

---

## 一、根因：markdown 渲染把 `local://` 地址清成了空串

正文里的图片用的是 WeKnora 内部存储协议——PDF 抽取的图片、知识库内嵌图片都是这个形态：

```markdown
![图1](local://10000/exports/xxx.jpg)
```

`react-markdown` v9 默认会用 `defaultUrlTransform` 清洗地址，它只放行
http / https / mailto / tel 与相对路径，**其余协议一律置空**。实测：

| 输入 | 默认清洗后 |
|---|---|
| `local://10000/exports/a.png` | **`""`** |
| `resource://abc` | **`""`** |
| `storage://1/local://x.png` | **`""`** |
| `https://a.com/x.png` | 保持 |

地址被清空后，图片组件连 src 都收不到 —— **图必然显示不出来，与文件是否存在无关**。
这也解释了为什么之前无论怎么修服务端数据，界面上都没有图。

排查中还发现渲染点覆盖不一致：

| 位置 | 修复前 | 结果 |
|---|---|---|
| 文档预览 | 没有 urlTransform | 图片挂 |
| wiki 正文 | 没有 urlTransform | 图片挂 |
| 问答回答 | 只放行了 `cite:` / `wiki:` | 图片挂 |

## 二、修复

新增 `src/utils/markdownUrl.js`，统一放行：

- **WeKnora 内部存储协议**：`resource://`、`local://`、`minio://`、`cos://`、`tos://`、`s3://`、`oss://`、`obs://`、`ks3://`，以及 `storage://<backend>/provider://`
- **应用自有协议**：引用胶囊 `cite:kb:n` / `cite:web:n`、wiki 链接 `wiki:…`

其余地址仍交给 `defaultUrlTransform` —— **放行自有协议不等于关闭清洗**：`javascript:` /
`data:text/html` / `vbscript:` / `file:` 依然被拦。三处渲染点（文档预览 ×2、wiki 正文、问答回答）全部接上。

## 三、验证

- 新增 `scripts/test-markdown-url.mjs`（52 项断言）：
  - 先钉住 bug：断言默认清洗确实会丢弃 `local://` / `resource://` / `storage://`
  - 再断言放行后原样返回（含大小写、`storage://` 组合形态、全部 provider 协议）
  - **反向断言**：危险协议必须仍被拦
  - 边界：裸 `local:`（缺 `//`）、空值、`https://a.com/local://x` 不误判
- 单测当场抓出实现缺陷：provider 协议是 `a|b|c` 形式的选择分支，拼接时漏了分组，
  导致只有最后一个协议生效 —— 已修
- 构建产物校验：白名单与三处引用均在 bundle 内；安全体检、其余三组回归测试全部通过

## 四、说明

本次同时确认：服务端数据是干净的（对 36 个知识库、996 个条目全类型扫描，
正文 / 预览 / 分块 / 摘要 / 列表接口里都没有残留的占位文本），
所以**只要装上这个包，图片就会显示**；服务端不需要再改动。
