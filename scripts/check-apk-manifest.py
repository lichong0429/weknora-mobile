#!/usr/bin/env python3
"""核对已发布的 APK 里，清单与原生改动是否真的生效。

为什么需要它：前端改动可以直接在 bundle 里搜字符串验证，但**原生（Java）与清单改动
在 .js 里看不到**。CI 只告诉你"构建成功"，不告诉你"权限/Provider/新方法真的进包了"。
这个脚本直接解析 APK：

  · 二进制 AndroidManifest.xml 的字符串池（AXML）→ 权限、Provider、meta-data 名
  · classes*.dex 的字符串池 → 新加的原生方法名（方法名会留在 dex 里）
  · resources.arsc + res/*.xml → 资源是否真的编译进去

用法：
    python scripts/check-apk-manifest.py <apk 路径>
    python scripts/check-apk-manifest.py <apk 路径> --expect REQUEST_INSTALL_PACKAGES,installUpdate

实现要点（都是踩过的坑）：
  1. 清单字符串池通常是 **UTF-16LE**，用 ASCII 字节搜是搜不到的 —— 必须按 AXML 结构解析。
  2. AXML 的 ResChunk_header 只有 8 字节（type u16 + headerSize u16 + size u32），
     字段偏移是 size@+4、stringCount@+8、styleCount@+12、flags@+16、stringsStart@+20、
     偏移数组@+28。**按 headerSize 当起点会整体错 4 字节**（会把 styleCount 读成字符串数）。
  3. `android:resource="@xml/xxx"` 编译后是**资源 ID 整数**，字符串池里不会有 `xxx`；
     要验证资源内容，得去 res/ 下找（注意 AGP 会把 res/xml/foo.xml **重命名为短名**
     如 res/8K.xml），所以按文件名字径搜索会误判为缺失 —— 用内容做字节级搜索更可靠。
"""
import struct
import sys
import zipfile


def read_string_pool(data, off):
    """解析 AXML 字符串池，返回 (strings, is_utf8)。off 指向 chunk 起点。"""
    assert struct.unpack_from('<I', data, off)[0] == 0x001C0001, '该处不是字符串池 chunk'
    string_count = struct.unpack_from('<I', data, off + 8)[0]
    flags = struct.unpack_from('<I', data, off + 16)[0]
    strings_start = struct.unpack_from('<I', data, off + 20)[0]
    is_utf8 = bool(flags & 0x100)
    base = off + strings_start

    out = []
    for i in range(string_count):
        p = base + struct.unpack_from('<I', data, off + 28 + 4 * i)[0]
        if is_utf8:
            n = data[p]
            p += 1
            if n & 0x80:
                n = ((n & 0x7F) << 8) | data[p]
                p += 1
            out.append(data[p:p + n].decode('utf-8', 'replace'))
        else:
            n = struct.unpack_from('<H', data, p)[0]
            p += 2
            if n & 0x8000:
                n2 = struct.unpack_from('<H', data, p)[0]
                p += 2
                n = ((n & 0x7FFF) << 16) | n2
            out.append(data[p:p + n * 2].decode('utf-16-le', 'replace'))
    return out, is_utf8


def manifest_strings(z):
    name = [n for n in z.namelist() if n.endswith('AndroidManifest.xml')][0]
    data = z.read(name)
    assert struct.unpack_from('<I', data, 0)[0] == 0x00080003, '不是二进制 XML'
    strings, is_utf8 = read_string_pool(data, 8)
    return name, strings, is_utf8


def search_all(z, needle, prefix=None):
    """在 APK 条目里按 UTF-8 / UTF-16LE 做字节级搜索。

    prefix 用于限制范围：验证「资源内容」时必须限定在 res/ 下 ——
    androidx 的 FileProvider 代码里本身就含 'external-files-path' / 'files-path'
    这些标签名（它在运行时按标签名解析），若不限范围，即使 XML 没编译进去
    也会因为命中 classes.dex 而误判为「已包含」。
    """
    hits = []
    for n in z.namelist():
        if prefix and not n.startswith(prefix):
            continue
        data = z.read(n)
        if needle.encode('utf-8') in data or needle.encode('utf-16-le') in data:
            hits.append(n)
    return hits


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if not args:
        print(__doc__)
        return 2
    apk = args[0]
    expect = []
    for a in sys.argv[1:]:
        if a.startswith('--expect'):
            expect = [x.strip() for x in a.split('=', 1)[1].split(',') if x.strip()]

    with zipfile.ZipFile(apk) as z:
        name, strings, is_utf8 = manifest_strings(z)
        print(f'APK: {apk}')
        print(f'清单: {name} | 字符串池: {"UTF-8" if is_utf8 else "UTF-16LE"} | {len(strings)} 条')
        print()

        checks = [
            ('安装未知应用权限', 'REQUEST_INSTALL_PACKAGES', 'manifest'),
            ('FileProvider 类', 'androidx.core.content.FileProvider', 'manifest'),
            ('Provider authority', '.fileprovider', 'manifest'),
            ('FILE_PROVIDER_PATHS meta-data', 'FILE_PROVIDER_PATHS', 'manifest'),
            ('INTERNET 权限（对照）', 'INTERNET', 'manifest'),
        ]
        print('清单核对：')
        all_ok = True
        for label, needle, _ in checks:
            hit = [s for s in strings if needle in s]
            all_ok = all_ok and bool(hit)
            print(f'  {"✓" if hit else "✗"} {label}' + (f'  → {hit[0]}' if hit else ''))

        dex = b''.join(z.read(n) for n in z.namelist() if n.endswith('.dex'))
        print()
        print('原生方法（dex 字符串池）：')
        for label, needle in [('downloadUpdate', 'downloadUpdate'),
                              ('installUpdate', 'installUpdate'),
                              ('canRequestPackageInstalls', 'canRequestPackageInstalls'),
                              ('__weknoraUpdate 回调', '__weknoraUpdate')]:
            ok = needle.encode() in dex
            all_ok = all_ok and ok
            print(f'  {"✓" if ok else "✗"} {label}')

        print()
        print('资源内容（限定 res/ 范围 + 按内容搜索，规避 AGP 的资源短名化与 dex 误命中）：')
        for needle in ('external-files-path', 'files-path', 'update/'):
            hits = search_all(z, needle, prefix='res/')
            ok = bool(hits)
            all_ok = all_ok and ok
            print(f'  {"✓" if ok else "✗"} {needle} → {hits if hits else "未命中"}')

        if expect:
            print()
            print('额外断言：')
            for needle in expect:
                hits = search_all(z, needle)
                ok = bool(hits)
                all_ok = all_ok and ok
                print(f'  {"✓" if ok else "✗"} {needle}')

    print()
    print('>> 结论:', '原生与清单改动均已进入 APK' if all_ok else '有缺失，检查构建产物')
    return 0 if all_ok else 1


if __name__ == '__main__':
    sys.exit(main())
