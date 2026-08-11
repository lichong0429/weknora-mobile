<!-- 发版前请将本文件内容替换为「当版」说明；若留空或删除本文件，CI 会自动回退为 Full Changelog 链接。 -->

# WeKnora Mobile v1.2.7

**Full Changelog**: https://github.com/lichong0429/weknora-mobile/compare/v1.2.6...v1.2.7

## 修复
- **修复知识条目详情页整页空白（白屏）**
  `KnowledgeDetail` 在 `useEffect` 依赖数组里引用了其后才用 `const` 声明的 `loadPreview`，
  触发 TDZ 崩溃（`ReferenceError: Cannot access 'loadPreview' before initialization`），
  组件在渲染阶段即抛错、无 error boundary 兜底 → 整页卸载成空白屏（红框才是后端报错，白屏即此特征）。
  - 引入 `loadPreviewRef`（`useRef`），`useEffect` 通过 ref 调用，避开「声明前引用」导致的 TDZ；
  - `binaryKind` 移出 `loadPreview` 依赖（改用 `binaryKindRef`），消除 `binaryKind` 变化引起的重渲染死循环；
  - 静默的 `if (!knowledge) return null` 改为可见的「未找到该知识条目」提示。

## 校验
- 修复提交 `1ed3ac4` 已落在 `origin/main` 顶端（fast-forward，无冲突）。
- `esbuild` 语法校验通过。
- 仅改动 `src/components/KnowledgeDetail.jsx`（+25 / -7），保留 v1.2.6 的全部预览/wiki 逻辑。
