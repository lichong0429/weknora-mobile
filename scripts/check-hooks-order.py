# -*- coding: utf-8 -*-
"""
静态排查：Hook 调用是否出现在提前 return 之后。

背景：React 要求每次渲染的 hook 调用数量与顺序一致。若某个 hook 位于
`if (loading) return ...` 之后，首帧（命中 return）不执行该 hook、
数据到达后的次帧才执行，hook 数量变化会让 React 抛错并卸载整棵树，
表现为「页面一片空白且返回不了」。这类问题构建期不报错，极难发现。

本脚本用启发式规则扫出候选，再由人工确认。

用法：
    python scripts/check-hooks-order.py

背景案例（v1.5.3 → v1.5.4）：KnowledgeDetail 新增的 useImageHydrate 被放在
`if (loading) return …` 之后，首帧不执行、次帧才执行，hook 数量从 N 变 N+2，
React 抛错并卸载整棵树 —— 表现为「文档页一片空白且返回不了」。
构建期无任何报错，产物字符串校验也发现不了，只能靠这类静态检查或实机验证。

注意：脚本是启发式，会把「辅助函数内的 if + return」误报为提前 return，
需人工看一眼确认（例如 VectorStoreList.jsx 的 fieldInput 即为误报）。
"""
import re
import glob
import os

CWD = r'E:/24221/Documents/WorkBuddy/2026-08-19-22-50-17/weknora-mobile/src'
files = sorted(glob.glob(os.path.join(CWD, 'components/*.jsx')) +
               glob.glob(os.path.join(CWD, 'hooks/*.js')) +
               glob.glob(os.path.join(CWD, 'contexts/*.jsx')))

# 顶层缩进 2 空格处的 hook 调用
HOOK_RE = re.compile(r'^  (?:const\s+.*?=\s*)?(use[A-Z]\w*)\s*[\(<]')
# 顶层缩进 2 空格的 if 块
IF_RE = re.compile(r'^  if\s*\(.*\{\s*$')

report = []
for path in files:
    src = open(path, encoding='utf-8', errors='replace').read()
    lines = src.split('\n')

    hooks = []
    for i, l in enumerate(lines):
        m = HOOK_RE.match(l)
        if m and m.group(1) not in ('useState', 'useRef', 'useEffect', 'useCallback', 'useMemo',
                                    'useContext', 'useReducer', 'useLayoutEffect', 'useAsync'):
            hooks.append((i + 1, m.group(1)))
        elif m:
            hooks.append((i + 1, m.group(1)))

    early = []
    for i, l in enumerate(lines):
        if IF_RE.match(l):
            for k in range(i + 1, min(i + 6, len(lines))):
                if re.match(r'^    return\b', lines[k]):
                    early.append((i + 1, l.strip()[:46]))
                    break

    if not hooks or not early:
        continue

    last_early = max(e[0] for e in early)
    suspect = [h for h in hooks if h[0] > last_early]
    if suspect:
        report.append((path, last_early, early, suspect))

print('扫描文件数:', len(files))
print('=' * 66)
if not report:
    print('未发现「hook 位于提前 return 之后」的候选 ✓')
else:
    for path, last_early, early, suspect in report:
        print('可疑文件:', os.path.basename(path))
        print('  最后一个提前 return 在第 %d 行' % last_early)
        for ln, txt in early:
            print('      L%-5d %s' % (ln, txt))
        print('  其后的 hook 调用：')
        for ln, name in suspect:
            print('      L%-5d %s' % (ln, name))
        print()
print('=' * 66)
print('结果:', 'PASS' if not report else '%d 个文件需人工确认' % len(report))
