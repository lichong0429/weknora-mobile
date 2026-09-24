#!/usr/bin/env node
/**
 * 发布前敏感信息体检
 * ---------------------------------------------------------------------------
 * 背景：本仓库是 PUBLIC。此前发生过两类真实事故：
 *   1) 发布说明里写了内网 NAS 地址 → 仓库文件与 Release 页面同时暴露；
 *   2) 签名密钥文件被 git add -f 强制提交，口令明文写在 build.gradle → 密钥+口令同时公开。
 * 这两类内容一旦推上去就"泼出去的水"，事后删文件也留在历史里。所以要在推送前拦截。
 *
 * 用法：
 *   node scripts/check-secrets.mjs              # 体检全部被 git 跟踪 / 已暂存的文件
 *   node scripts/check-secrets.mjs --staged      # 只体检已暂存文件（配合 pre-commit）
 *   node scripts/check-secrets.mjs --self-test   # 规则自检（用内置样本验证每条规则真能命中）
 *   node scripts/check-secrets.mjs --quiet       # 只输出问题与汇总
 *
 * 退出码：存在 BLOCK 级问题 → 1；仅 WARN / 已知例外 → 0
 *
 * 设计取舍：
 *   - 命中内容一律**打码输出**（内网地址只留前两段、密钥只留前 4 位），
 *     避免体检日志本身变成新的泄露源。
 *   - 已知例外必须写明理由与「何时移除」，不做无限期豁免。
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = new Set(process.argv.slice(2));
const STAGED_ONLY = args.has('--staged');
const QUIET = args.has('--quiet');
const SELF_TEST = args.has('--self-test');

const MAX_FILE_BYTES = 2 * 1024 * 1024;

// 体检脚本自身必须排除：它按设计要包含各种"像密钥/像内网地址"的合成样本
// （自检用的正则与示例串），扫描自身只会产生固定噪音，形成"狼来了"效应。
// 代价：无法发现本文件内被塞入的真实凭据 —— 因此本文件不接受任何真实凭据。
const SELF_PATH = 'scripts/check-secrets.mjs';
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svgz', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.gz', '.tar', '.pdf', '.mp4', '.mp3', '.apk', '.aab', '.so', '.dex',
  '.keystore', '.jks', '.jar'
]);

// --- 已知例外 -------------------------------------------------------------
// 每条必须写理由 + 移除条件。体检会照常报出，但按 WARN 计数、不阻断。
const KNOWN_EXCEPTIONS = [
  {
    file: 'android-ci/ci.keystore',
    rule: 'keystore-file',
    reason: 'CI 签名依赖该文件；密钥与口令此前已进入公开仓库，属既存安全债',
    removeWhen: '完成密钥轮换、CI 改从 GitHub Secret 读取后，执行 git rm --cached 并删除本条'
  },
  {
    file: 'webview-app/app/build.gradle',
    rule: 'secret-assignment',
    reason: 'CI 构建需要签名口令，当前仍是明文（与上一条同源的安全债）',
    removeWhen: '密钥轮换时改为 System.getenv(...) + GitHub Secret，随后删除本条'
  }
];

// --- 规则 -----------------------------------------------------------------
// severity: block = 必须修掉才能发；warn = 需要人工确认是否可接受
const RULES = [
  {
    id: 'private-ip',
    name: '内网 / Tailscale 地址',
    severity: 'block',
    // 10/8、172.16-31/12、192.168/16、100.64-127/10（Tailscale 与运营商 CGNAT 都在这里）
    // 四个八位组必须写全，否则 "10.0.0.12" 这类地址会因后面的点被 (?![\d.]) 拒绝而漏检
    regex: /(?<![\d.])(?:10\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}|192\.168\.\d{1,3}|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3})\.\d{1,3}(?![\d.])/g,
    advice: '文档里用「自建实例 / 内网地址」等描述代替具体地址'
  },
  {
    id: 'secret-assignment',
    name: '口令 / 密钥赋值',
    severity: 'block',
    // 两种写法都要覆盖：
    //   JSON/JS/Python  →  storePassword: "xxx" / api_key = "xxx"
    //   Gradle(Groovy)  →  storePassword 'xxx'   ← 没有等号，早期版本漏检过
    // 取值必须是「像真实凭据」的纯 ASCII 串：这样中文占位说明（如 "见本机密钥管理"）
    // 与 <占位符> 不会被误报，否则规则会天天喊狼来了
    regex: /(?:storePassword|keyPassword|keystorePassword|apiKey|api_key|secret|token|password|passwd|pwd)\s*(?:[:=]\s*|\s+)["'][A-Za-z0-9_\-+!@#$%^&*.=]{6,}["']/gi,
    advice: '改从环境变量 / CI Secret 读取，代码里不留字面量'
  },
  {
    id: 'token-literal',
    name: '凭据字面量',
    severity: 'block',
    // 常见平台 token 前缀；结尾用宽松量词，避免规则本身被误匹配
    regex: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{12,}|xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    advice: '立刻吊销该凭据并改用环境变量'
  },
  {
    id: 'private-key-block',
    name: '私钥内容',
    severity: 'block',
    regex: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g,
    advice: '私钥文件不应入库'
  },
  {
    id: 'keystore-file',
    name: '签名密钥文件',
    severity: 'block',
    regex: /\.(?:keystore|jks|p12|pfx|mobileprovision)$/i,
    matchPath: true,
    advice: '加入 .gitignore 并从索引移除：git rm --cached <file>'
  },
  {
    id: 'local-path',
    name: '本机绝对路径（含用户名）',
    severity: 'warn',
    regex: /(?:[A-Za-z]:[\\/](?:Users|Documents)[\\/][^\\/\s"')]{2,}|[A-Za-z]:[\\/]{1,2}242\d{2}[\\/]|\/(?:Users|home)\/[A-Za-z0-9._-]{2,}\/)/g,
    advice: '换成相对路径或 $HOME / 环境变量，避免暴露本机用户名与目录结构'
  },
  {
    id: 'email',
    name: '个人邮箱',
    severity: 'warn',
    regex: /\b[A-Za-z0-9._%+-]+@(?:qq|163|126|gmail|outlook|foxmail|hotmail)\.(?:com|cn)\b/gi,
    advice: '确认是否必须公开；可用 GitHub noreply 邮箱替代'
  }
];

// 扫描范围：被 git 跟踪的文件（= 会随推送一起公开）
function listFiles() {
  const run = (a) => {
    try {
      return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split('\n').map((s) => s.trim()).filter(Boolean);
    } catch {
      return [];
    }
  };
  if (STAGED_ONLY) return run(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  const tracked = run(['ls-files']);
  const stagedNew = run(['diff', '--cached', '--name-only', '--diff-filter=ACMR']);
  return [...new Set([...tracked, ...stagedNew])];
}

function mask(match) {
  const s = String(match);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s.trim())) {
    const p = s.trim().split('.');
    return `${p[0]}.${p[1]}.x.x`;
  }
  if (s.length <= 8) return s[0] + '***';
  return `${s.slice(0, 4)}…（长 ${s.length}，已打码）`;
}

function scanText(text, rule) {
  const out = [];
  const re = new RegExp(rule.regex.source, rule.regex.flags);
  let m;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(0, m.index);
    const line = before.split('\n').length;
    out.push({ line, match: m[0] });
    if (out.length > 200) break; // 防御性上限
    if (m.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

function isException(file, ruleId) {
  return KNOWN_EXCEPTIONS.find((e) => e.file === file && e.rule === ruleId);
}

function runScan() {
  const files = listFiles();
  const findings = { block: [], warn: [], exception: [] };
  const readFiles = new Set(); // 按文件去重，避免同一文件被多条规则重复计数

  for (const file of files) {
    if (file === SELF_PATH) continue;
    const ext = path.extname(file).toLowerCase();
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue; // 已被删除但仍在索引里
    }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) continue;

    for (const rule of RULES) {
      if (rule.matchPath) {
        if (rule.regex.test(file)) {
          const ex = isException(file, rule.id);
          const hit = { file, rule, line: 0, match: file };
          if (ex) findings.exception.push({ ...hit, exception: ex });
          else findings.block.push(hit);
        }
        continue;
      }
      if (SKIP_EXT.has(ext)) continue;
      let text;
      try {
        text = fs.readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      readFiles.add(file);
      for (const hit of scanText(text, rule)) {
        const ex = isException(file, rule.id);
        const item = { file, rule, line: hit.line, match: hit.match };
        if (ex) findings.exception.push({ ...item, exception: ex });
        else findings[rule.severity].push(item);
      }
    }
  }
  return { fileCount: files.length, scanned: readFiles.size, findings };
}

// --- 自检：用样本确认每条规则真的能命中（规则写错时最危险：静默全绿）----------
function selfTest() {
  const samples = [
    ['private-ip', 'deploy: http://100.97.171.99:8000/api'],
    ['private-ip', 'host = 192.168.31.24'],
    ['private-ip', 'nas 10.0.0.12'],
    ['private-ip', 'vpc 172.20.5.9'],
    ['secret-assignment', "storePassword 'abcd1234'"],
    ['secret-assignment', 'api_key: "abcdef123456"'],
    ['token-literal', 'Authorization: Bearer ' + 'ghp_' + 'A'.repeat(36)],
    ['private-key-block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['local-path', 'C:/Users/someone/.config/app.json'],
    ['local-path', 'E:\\24221\\Documents\\proj\\x.md'],
    ['email', 'mail: someone@qq.com']
  ];
  const negatives = [
    ['private-ip', 'listen on 127.0.0.1:8080'],
    ['private-ip', 'version 1.2.3.4 build'],
    ['private-ip', '172.15.0.1 and 172.32.0.1 are public'],
    ['secret-assignment', 'apiKey = getApiKey()'],
    ['secret-assignment', "storePassword System.getenv('WEKNORA_STORE_PW')"],
    ['secret-assignment', 'password: "见本机密钥管理"'],
    ['local-path', 'path: ./android.keystore']
  ];
  let bad = 0;
  console.log('--- 规则自检（正样本应命中）---');
  for (const [id, text] of samples) {
    const rule = RULES.find((r) => r.id === id);
    const hit = scanText(text, rule).length > 0;
    if (!hit) bad += 1;
    console.log(`${hit ? 'PASS' : 'FAIL'}  ${id.padEnd(20)} ${hit ? '' : '未命中: ' + text}`);
  }
  console.log('--- 规则自检（反样本不应命中）---');
  for (const [id, text] of negatives) {
    const rule = RULES.find((r) => r.id === id);
    const hit = scanText(text, rule).length > 0;
    if (hit) bad += 1;
    console.log(`${hit ? 'FAIL' : 'PASS'}  ${id.padEnd(20)} ${hit ? '误命中: ' + text : ''}`);
  }
  console.log(bad ? `\n自检未通过：${bad} 项` : `\n自检全部通过（${samples.length + negatives.length} 项）`);
  return bad;
}

// --- 主流程 ---------------------------------------------------------------
if (SELF_TEST) {
  process.exit(selfTest() ? 1 : 0);
}

const { fileCount, scanned, findings } = runScan();
const printGroup = (title, items, tag) => {
  if (items.length === 0) return;
  console.log(`\n${title}`);
  for (const it of items) {
    const loc = it.line ? `${it.file}:${it.line}` : it.file;
    console.log(`  ${tag} [${it.rule.name}] ${loc}`);
    console.log(`       命中：${mask(it.match)}`);
    if (it.exception) console.log(`       已知例外：${it.exception.reason}；移除条件：${it.exception.removeWhen}`);
    else if (it.rule.advice) console.log(`       处理建议：${it.rule.advice}`);
  }
};

if (!QUIET) {
  console.log(`敏感信息体检：扫描 ${fileCount} 个受控文件（实际读取 ${scanned} 个文本文件）`);
}

printGroup('阻断项（必须处理后再推送）', findings.block, '⛔');
printGroup('已知例外（记录在案，需按条件移除）', findings.exception, '⚠');
printGroup('待确认项（人工判断是否可接受）', findings.warn, '△');

console.log(
  `\n汇总：阻断 ${findings.block.length} · 已知例外 ${findings.exception.length} · 待确认 ${findings.warn.length}`
);
if (findings.block.length === 0) {
  console.log('结果：通过（无阻断项）');
  process.exit(0);
}
console.log('结果：未通过 —— 上述阻断项会随 git push 一起公开，请先处理');
process.exit(1);
