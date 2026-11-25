#!/usr/bin/env node
/**
 * 「服务器身份归一化」回归测试（纯逻辑，不联网）。
 *
 * 为什么这份测试必须存在：
 * `planRestore()` 决定「挂载登录页时要不要把本机保存的密码回填到输入框」。
 * 一旦它把两台不同服务器判成同一台，用户会在**不知情**的情况下看到 A 站密码被
 * 填进 B 站的输入框，点一次登录，A 站密码就被明文 POST 到 B 站 —— 这是凭据泄漏，
 * 不是 UI bug。所以这条判定属于安全代码，必须有机器可跑的回归，不能只靠 review。
 *
 * 被测对象是 `src/utils/baseUrlIdentity.js`（纯 JS，Node 可直接 import）。
 * 之前这三个函数长在 `Login.jsx` 里，Node 无法 import（含 JSX 语法），
 * 只能 import 一份"拷贝"来断言 —— 拷贝改坏了测试也不会红，等于没有证据。
 *
 * 锁定两起实测过的真实缺陷（都会导致"不同服务器被判成同一台"）：
 *
 *   1) `new URL('localhost:8080')` **不抛异常**：它把 `localhost` 当协议、`8080`
 *      当路径，`origin` 变成字符串 `'null'`。于是 `localhost:8080` 与
 *      `example.com:8080` 都会得到 `'null' + '8080' = 'null8080'`，被判同源
 *      → 回填密码。触发门槛极低：输入框 placeholder 就是 `http://localhost:8080`，
 *      用户手输时把 `http://` 删掉就会踩到。
 *      修法：无协议先补 `http://` 再解析；且**任何情况下不得返回 `'null'`**。
 *
 *   2) 只比 `origin` 会丢掉路径前缀：`http://host/weknora` 与 `http://host/other`
 *      都等于 `http://host`。而 `api/client.js` 的 `buildUrl` 只剥 `/api` 与
 *      `/api/v1`、其余路径保留，说明「子路径反代部署」是受支持的 ——
 *      同 host 下的两套实例必须判为不同。
 *
 * 用法：node scripts/test-base-url-identity.mjs
 * 退出码：0 通过 / 1 失败
 */
import {
  normalizeBaseUrl,
  hostOfBaseUrl,
  planRestore
} from '../src/utils/baseUrlIdentity.js';
import { planSaveToggle, planStaleCredential } from '../src/utils/loginPolicy.js';

let pass = 0;
const failures = [];

function check(name, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}\n      期望 ${e}\n      实际 ${a}`);
  }
}

function checkTrue(name, cond, detail = '') {
  if (cond) pass += 1;
  else {
    failures.push(name);
    console.log(`FAIL  ${name}  ${detail}`);
  }
}

/** 两个地址必须被判为「同一台服务器」 */
function same(label, a, b) {
  const na = normalizeBaseUrl(a);
  const nb = normalizeBaseUrl(b);
  checkTrue(`${label}：应判同源 [${a}] == [${b}]`, na === nb, `实际 ${JSON.stringify(na)} vs ${JSON.stringify(nb)}`);
}

/** 两个地址必须被判为「不同服务器」 */
function differs(label, a, b) {
  const na = normalizeBaseUrl(a);
  const nb = normalizeBaseUrl(b);
  checkTrue(`${label}：应判不同源 [${a}] != [${b}]`, na !== nb, `实际两者都是 ${JSON.stringify(na)}`);
}

/**
 * 安全调用被测函数：抛错时返回 fallback。
 *
 * 为什么需要它：本文件有大量断言在验证"这些函数不抛"。如果调用点自己写成
 * `planStaleCredential().uncheck`，一旦实现真的抛了，抛错会**中断整个测试进程**，
 * 后面的几百条断言根本不会跑，摘要也不会打印 —— 于是"抓到 1 个 bug"看起来像
 * "测试脚本本身崩了"，且其余回归全部静默丢失。
 * 用 safe() 包一层，失败会以普通 FAIL 行出现，一次跑完看到全部问题。
 */
function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

// =====================================================================
// 1) 缺口 1 回归：无协议地址不得塌成同一台
// =====================================================================

differs('缺口1 端口不同', 'localhost:8080', 'localhost:9999');

// 「不相等」还不够 —— 如果两者都退化成 'null'，相等性检查会失败但错误方向不明；
// 如果都退化成 ''，planRestore 里的 Boolean() 会兜住（安全方向）；
// 只有 'null' 是**危险且静默**的退化形态：非空、且任意两台都相等。单独钉死它。
const bareA = normalizeBaseUrl('localhost:8080');
const bareB = normalizeBaseUrl('localhost:9999');
checkTrue('缺口1 无协议地址不得退化成字符串 "null"', bareA !== 'null' && bareB !== 'null', `实际 ${JSON.stringify([bareA, bareB])}`);
checkTrue('缺口1 无协议地址归一化结果必须非空', bareA !== '' && bareB !== '', `实际 ${JSON.stringify([bareA, bareB])}`);
checkTrue('缺口1 归一化结果不得以 "null" 开头', !bareA.startsWith('null') && !bareB.startsWith('null'), `实际 ${JSON.stringify([bareA, bareB])}`);

// 缺口 1 的加严版：主机名不同也会撞（'null' + '8080' 两两相同）
differs('缺口1 加严：不同主机同端口', 'localhost:8080', 'example.com:8080');
differs('缺口1 加严：不同主机不同端口', 'a.example.com:9000', 'b.example.com:9000');
// 补协议必须等价于用户写了协议（否则"同一台"被判成两台，密码永远不回填）
same('缺口1 无协议与有协议等价', 'localhost:8080', 'http://localhost:8080');
same('缺口1 无协议主机名等价', 'host.example.com/', 'host.example.com');

// =====================================================================
// 2) 缺口 2 回归：路径前缀必须参与服务器身份
// =====================================================================

differs('缺口2 同 host 不同子路径', 'http://host/a', 'http://host/b');
differs('缺口2 子路径反代两套实例', 'http://host/weknora', 'http://host/other');
differs('缺口2 一台有子路径一台没有', 'http://host', 'http://host/weknora');
// 修缺口 2 不能把尾斜杠等价性搞坏
same('缺口2 带路径时尾斜杠仍等价', 'http://host/a', 'http://host/a/');
// 路径大小写保持敏感（服务端可能靠大小写区分资源，保守优先）
differs('路径大小写敏感', 'http://host/A', 'http://host/a');

// =====================================================================
// 3) 归一化等价类（不该被判成两台的情形）
// =====================================================================

same('等价：末尾斜杠', 'http://h:8080/', 'http://h:8080');
same('等价：主机名大小写', 'https://Host.Example.com', 'https://host.example.com');
same('等价：协议大小写', 'HTTPS://host.example.com', 'https://host.example.com');
same('等价：默认端口 80', 'http://h:80', 'http://h');
same('等价：默认端口 443', 'https://h:443', 'https://h');
same('等价：首尾空白', '  http://h:8080  ', 'http://h:8080');
same('等价：/api/v1 后缀', 'http://h/api/v1', 'http://h');
same('等价：/api 后缀', 'http://h/api', 'http://h');
same('等价：/api/v1 后缀 + 尾斜杠', 'http://h/api/v1/', 'http://h/');
same('等价：子路径 + /api 后缀', 'http://h/weknora/api', 'http://h/weknora');

// 明确**不合并**的情形（合并了就会把密码送去别的服务器/协议）
differs('不合并：localhost 与 127.0.0.1', 'http://localhost:8080', 'http://127.0.0.1:8080');
differs('不合并：http 与 https', 'http://h', 'https://h');
differs('不合并：端口不同', 'http://h:8080', 'http://h:9090');
differs('不合并：不同主机', 'http://a.example.com', 'http://b.example.com');
differs('不合并：localhost 有端口与无端口', 'localhost', 'localhost:8080');

// =====================================================================
// 4) 空值 / 坑值：一律归零，绝不返回 'null' / 'undefined'
// =====================================================================

const emptyInputs = [
  ['空串', ''],
  ['纯空白', '   \t\n '],
  ['null', null],
  ['undefined', undefined],
  ['数字 0', 0],
  ['NaN', NaN],
  ['空对象', {}],
  ['空数组', []],
  ['布尔 true', true]
];
for (const [label, value] of emptyInputs) {
  check(`空值（${label}）：归一化为空串`, normalizeBaseUrl(value), '');
  check(`空值（${label}）：host 为空串`, hostOfBaseUrl(value), '');
}

// 原串恰好是 'null' / 'undefined' 字面量时，不能把坑值当地址返回
checkTrue('坑值：输入 "null" 不得原样返回 "null"', normalizeBaseUrl('null') !== 'null', `实际 ${JSON.stringify(normalizeBaseUrl('null'))}`);
checkTrue('坑值：输入 "undefined" 不得原样返回 "undefined"', normalizeBaseUrl('undefined') !== 'undefined', `实际 ${JSON.stringify(normalizeBaseUrl('undefined'))}`);

// =====================================================================
// 4b) 基线快照：归一化结果的**具体表示**
//
// 上面几组断言的是"关系"（相等/不等），这组钉的是"输出长什么样"。
// 之所以两样都要：关系断言保证安全性（谁把缺口改回去会红），
// 快照断言保证**表示形式不会被悄悄改动**。这个值会进 planRestore 的比较、
// 也可能进日志/提示，表示一变就是一次需要被看见的决定 ——
// 如果你有意改变表示形式（例如退化串改成返回 ''），请同步更新本节并在 PR 里说明理由。
// =====================================================================

const baseline = [
  ['localhost:8080', 'http://localhost:8080'],
  ['localhost:9999', 'http://localhost:9999'],
  ['http://host/a', 'http://host/a'],
  ['http://host/b', 'http://host/b'],
  ['http://h:80', 'http://h'],                    // 默认端口被 origin 吃掉
  ['http://host/a/', 'http://host/a'],            // 尾斜杠被剥
  ['http://host/api/v1', 'http://host'],          // 剥 API 后缀
  ['http://127.0.0.1:8080', 'http://127.0.0.1:8080'],
  ['https://h', 'https://h'],
  ['not a url', 'not a url'],                     // 完全无法解析 → 退化原样（不抛、不返回空）
  ['', '']
];
for (const [input, expected] of baseline) {
  check(`基线快照 [${input}]`, normalizeBaseUrl(input), expected);
}

// host 的基线表示
check('基线快照 host [localhost:8080]', hostOfBaseUrl('localhost:8080'), 'localhost:8080');

// planRestore 的基线表示（lead 实测口径）
check('基线快照 planRestore 跨源', planRestore({ savedBaseUrl: 'http://a:8080', currentBaseUrl: 'http://b:8080' }), {
  fillEmail: true,
  fillPassword: false,
  sameServer: false,
  host: 'a:8080'
});

// =====================================================================
// 5) planRestore：四个真实场景
// =====================================================================
// 5.1 同源（含尾斜杠 + 大小写差异）→ 回填密码
const samePlan = planRestore({ savedBaseUrl: 'https://A.example.com:8443/', currentBaseUrl: 'https://a.example.com:8443' });
check('场景1 同源：fillPassword', samePlan.fillPassword, true);
check('场景1 同源：sameServer', samePlan.sameServer, true);
check('场景1 同源：fillEmail 恒为 true', samePlan.fillEmail, true);
check('场景1 同源：host 带端口', samePlan.host, 'a.example.com:8443');

// 5.2 跨源 → 不回填密码，但仍回填邮箱，并给出「保存的那台」用于提示
const crossPlan = planRestore({ savedBaseUrl: 'https://a.example.com', currentBaseUrl: 'https://b.example.com' });
check('场景2 跨源：fillPassword', crossPlan.fillPassword, false);
check('场景2 跨源：sameServer', crossPlan.sameServer, false);
check('场景2 跨源：仍回填 email（跨站无风险）', crossPlan.fillEmail, true);
check('场景2 跨源：host 是保存的那台', crossPlan.host, 'a.example.com');

// 5.3 当前地址为空（用户清空了输入框）→ 无法证明同源，只回填邮箱
const noCurrent = planRestore({ savedBaseUrl: 'https://a:9000', currentBaseUrl: '' });
check('场景3 当前地址空：fillPassword', noCurrent.fillPassword, false);
check('场景3 当前地址空：仍回填 email', noCurrent.fillEmail, true);
check('场景3 当前地址空：host 仍可展示', noCurrent.host, 'a:9000');

// 5.4 老数据（密文里没有 baseUrl）→ 无法证明同源，不回填密码
const noSaved = planRestore({ savedBaseUrl: '', currentBaseUrl: 'https://a.example.com' });
check('场景4 老数据：fillPassword', noSaved.fillPassword, false);
check('场景4 老数据：仍回填 email', noSaved.fillEmail, true);
check('场景4 老数据：host 为空串（调用方据此静默，不渲染残句）', noSaved.host, '');

// 5.5 缺口 1 的端到端后果：无协议两台不同机器，绝不能回填密码
const gap1Plan = planRestore({ savedBaseUrl: 'localhost:8080', currentBaseUrl: 'example.com:8080' });
check('场景5 缺口1 端到端：不同机器不回填密码', gap1Plan.fillPassword, false);
// 反向：同一台只是写法不同，必须回填（否则用户以为功能坏了）
const gap1SamePlan = planRestore({ savedBaseUrl: 'localhost:8080', currentBaseUrl: 'http://localhost:8080/' });
check('场景6 缺口1 端到端：同机器不同写法要回填', gap1SamePlan.fillPassword, true);

// 5.6 无参调用不抛（组件里可能因为配置读取失败传 undefined）
// 用 safe() 包住：实现若抛错，这里要出 FAIL 而不是把整个测试进程打断
const defaultPlan = safe(() => planRestore(), {});
check('场景7 无参：不回填密码', defaultPlan.fillPassword, false);
check('场景7 无参：host 为空串', defaultPlan.host, '');

// =====================================================================
// 6) planRestore 结构性红线：返回值里不允许出现任何地址字段
//
// 这是「绝不因为回填而静默改服务器」这条红线的机器化守卫：
// 只要 plan 里没有 baseUrl/url，调用方在写代码时就"顺手"把地址写回去。
// =====================================================================

const allPlans = [
  ['同源', samePlan],
  ['跨源', crossPlan],
  ['当前空', noCurrent],
  ['老数据', noSaved],
  ['缺口1 跨机', gap1Plan],
  ['无参', defaultPlan]
];
const allowedKeys = ['fillEmail', 'fillPassword', 'host', 'sameServer']; // 已按字典序排好
for (const [label, plan] of allPlans) {
  const keys = Object.keys(plan).sort();
  check(`红线（${label}）：返回值键集固定`, keys, allowedKeys);
  checkTrue(
    `红线（${label}）：不含任何地址字段`,
    keys.every((k) => !/url|base|host/i.test(k) || k === 'host'),
    `keys=${JSON.stringify(keys)}`
  );
}
// host 只用于展示，不是可直接写回的地址：必须能被 URL 安全使用而又不构成完整地址
checkTrue(
  '红线：host 是展示串而非完整地址（不含协议）',
  allPlans.every(([, plan]) => !/^https?:\/\//i.test(plan.host)),
  JSON.stringify(allPlans.map(([, p]) => p.host))
);

// =====================================================================
// 7) hostOfBaseUrl：给用户看的「这份密码属于哪台」
// =====================================================================

check('host：带端口', hostOfBaseUrl('https://a.example.com:8080'), 'a.example.com:8080');
check('host：默认端口被吃掉', hostOfBaseUrl('https://a.example.com:443'), 'a.example.com');
// 注意：host 只给 host:port，**路径被丢弃**（提示语要短、好读，这是刻意的）。
// 因此「子路径反代」场景下提示语分辨不出是哪套实例 —— 但这不影响安全性：
// 回填判定用的是 normalizeBaseUrl()（**含路径**），不会因为提示语粗糙而错误回填。
// 别把 host 当唯一标识去做比较逻辑。
check('host：只给 host，路径被丢弃（不可用作唯一标识）', hostOfBaseUrl('https://host/weknora'), 'host');
check('host：无协议带端口不得是 "null"', hostOfBaseUrl('localhost:8080'), 'localhost:8080');
check('host：非法串原样返回且不抛', hostOfBaseUrl('not a url'), 'not a url');
check('host：超长退化串被截断（避免撑破提示气泡）', hostOfBaseUrl('not a url '.repeat(20)).length, 49);
checkTrue('host：超长退化串以省略号结尾', hostOfBaseUrl('not a url '.repeat(20)).endsWith('…'), hostOfBaseUrl('not a url '.repeat(20)));
check('host：ftp 协议归为退化串', hostOfBaseUrl('ftp://x'), 'ftp://x');

// =====================================================================
// 8) 所有导出函数对任意垃圾输入都不得抛异常
//
// 与 test-secure-store.mjs 同一套纪律：这些函数跑在登录页挂载路径上，
// 抛一次就是整页白屏，而用户看到的是"App 打不开"。
// =====================================================================

const garbage = [
  ['null', null],
  ['undefined', undefined],
  ['数字', 12345],
  ['NaN', NaN],
  ['布尔', false],
  ['对象', { a: 1 }],
  ['数组', [1, 2]],
  ['函数', () => {}],
  ['超长串', 'x'.repeat(10000)],
  ['只有协议', 'http://'],
  ['单斜杠', 'http:/host'],
  ['非 http 协议', 'ftp://x'],
  ['javascript 伪协议', 'javascript:alert(1)'],
  ['含空格', 'not a url'],
  ['端口非法', 'http://h:abc'],
  ['只有端口', ':8080'],
  ['中文', '本地服务器'],
  ['控制字符', 'http://h/\u0000\u0007']
];

for (const [label, value] of garbage) {
  let threw = null;
  let out = null;
  try {
    out = normalizeBaseUrl(value);
  } catch (err) {
    threw = err;
  }
  check(`不抛（normalize ${label}）`, threw, null);
  checkTrue(`不抛（normalize ${label}）：返回字符串`, typeof out === 'string', `实际 ${typeof out}`);

  let hostThrew = null;
  let hostOut = null;
  try {
    hostOut = hostOfBaseUrl(value);
  } catch (err) {
    hostThrew = err;
  }
  check(`不抛（hostOfBaseUrl ${label}）`, hostThrew, null);
  checkTrue(`不抛（hostOfBaseUrl ${label}）：返回字符串`, typeof hostOut === 'string', `实际 ${typeof hostOut}`);
}

// planRestore 的入参容错：undefined / null / 空对象都必须安全退化成"不回填密码"。
// 这条曾经是缺口（`input = {}` 只吃 undefined、不吃 null），修复后在此钉死，
// 避免以后有人把默认参数改回 `= {}` 的单层写法。
for (const [label, arg] of [['undefined', undefined], ['null', null], ['空对象', {}], ['多余字段', { foo: 1 }]]) {
  let threw = null;
  let plan = null;
  try {
    plan = planRestore(arg);
  } catch (err) {
    threw = err;
  }
  check(`不抛（planRestore ${label}）`, threw, null);
  check(`不抛（planRestore ${label}）：默认不回填密码`, plan && plan.fillPassword, false);
  check(`不抛（planRestore ${label}）：host 为空串`, plan && plan.host, '');
}

// =====================================================================
// 9) 附加：登录页两个状态决策纯函数（同属"安全/隐私判断，不能只靠肉眼"）
// =====================================================================

// 勾选框是**偏好**，已保存徽标是**状态**：取消勾选要立刻清本机密文
const toggleOff = planSaveToggle({ next: false, available: true });
check('勾选框：取消勾选 → 清本机密文', toggleOff.clearStore, true);
check('勾选框：取消勾选 → 偏好仍要落 config', toggleOff.persist, true);
check('勾选框：取消勾选 → 提示已关闭', toggleOff.notice, 'off');

const toggleOn = planSaveToggle({ next: true, available: true });
check('勾选框：勾上且可用 → 不清库、无提示', [toggleOn.clearStore, toggleOn.notice], [false, '']);

// 浏览器（无原生存储）：勾了也存不了，必须明说而不是静默失败
const toggleUnavailable = planSaveToggle({ next: true, available: false });
check('勾选框：环境不支持 → 提示 unavailable', toggleUnavailable.notice, 'unavailable');
check('勾选框：环境不支持 → 不去清库', toggleUnavailable.clearStore, false);
// 反向：无桥时取消勾选不能提示"已清除"（这是假话）
check('勾选框：环境不支持时取消 → 无提示', planSaveToggle({ next: false, available: false }).notice, '');

// 401 回退：密码框一定清空；偏好/提示/删库只在「存过 **且** 同源」时才动。
// 注意入参必须带地址才能表达"同源"—— 不带地址的语义已经是"地址未知"（见下面 fail-safe 组）。
const staleHad = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'https://a.example.com',
  currentBaseUrl: 'https://a.example.com'
});
check('401 回退（存过且同源）：清密码框', staleHad.clearPassword, true);
check('401 回退（存过且同源）：取消勾选', staleHad.uncheck, true);
check('401 回退（存过且同源）：提示已失效', staleHad.showExpiredNotice, true);

const staleNone = planStaleCredential({ hadSaved: false });
check('401 回退（没存过）：仍清密码框', staleNone.clearPassword, true);
check('401 回退（没存过）：不动用户偏好', staleNone.uncheck, false);
check('401 回退（没存过）：不谎称"已保存的密码已失效"', staleNone.showExpiredNotice, false);
// 入参缺失按"没存过"处理（真实调用点永远传对象字面量；此处用 {} 守住契约边界）
check('401 回退（空对象）：按没存过处理', planStaleCredential({}).uncheck, false);

// fail-safe：存过但**地址未知** → 无法确认这份密文属于当前服务器 → 一律不动
const staleUnknownAddress = planStaleCredential({ hadSaved: true });
check('401 回退（存过但地址未知，fail-safe）：不删库', staleUnknownAddress.clearStore, false);
check('401 回退（存过但地址未知，fail-safe）：不动用户偏好', staleUnknownAddress.uncheck, false);
check('401 回退（存过但地址未知，fail-safe）：不谎称已失效', staleUnknownAddress.showExpiredNotice, false);
check('401 回退（存过但地址未知，fail-safe）：密码框仍清空', staleUnknownAddress.clearPassword, true);

// ---------------- 401 的破坏性动作必须受 hadSaved 约束（真实 bug 的回归锚）----------------
//
// 曾经的真实路径：用户 A 站存过密码 → 切到 B 站 → B 站手滑输错一次拿到 401
// → 旧代码无条件 secureClear()，把 A 站那份**仍然有效**的凭据删了，
// 而且因为 had=false 连提示都不弹 —— 用户无感知丢凭据，属于数据丢失。
check('401+存过且地址未知（fail-safe）：不删本机密文', safe(() => planStaleCredential({ hadSaved: true }), {}).clearStore, false);
check('401+没存过：绝不许删本机密文', safe(() => planStaleCredential({ hadSaved: false }), {}).clearStore, false);
check('401 无参：按没存过处理，不删库', safe(() => planStaleCredential(), {}).clearStore, false);
check('401 传 null：按没存过处理，不删库', safe(() => planStaleCredential(null), {}).clearStore, false);

// 不变式：clearStore 与 uncheck 必须同源 —— 若将来有人把它们拆成两套判断，
// 就会出现"删了库却没关勾选"或"关了勾选却没删库"的中间态。
checkTrue(
  '不变式：clearStore 与 uncheck 永远同源',
  [true, false].every((had) => {
    const plan = planStaleCredential({ hadSaved: had });
    return plan.clearStore === plan.uncheck;
  }),
  JSON.stringify([true, false].map((had) => planStaleCredential({ hadSaved: had })))
);
// 密码框清空必须**无条件**：401 说明当前输入框里那串不对，与是否存过密码无关。
// 若只在 hadSaved 时才清空，用户手输错的密码会留在框里，下次提交还是错的。
checkTrue(
  '不变式：clearPassword 恒为 true（与是否存过无关）',
  [true, false].every((had) => planStaleCredential({ hadSaved: had }).clearPassword === true)
);

// ---------------- 401 的「服务器身份」二次确认（跨站手滑不许删别人的凭据）----------------
//
// `hasSavedPassword` 描述的是**上次 load() 那一刻**的判定，之后用户可能改过地址；
// 而且它对「跨站」也是 true（组件刻意如此：本机确实存着凭据，「清除」入口要能点到）。
// 所以 401 时不能用它单独决定要不要删库，必须拿「密文里记的地址」与「当前地址」
// 重新比一次 —— 这就是 planStaleCredential 的 savedServerUrl / currentBaseUrl 入参。
const staleSame = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'https://a.example.com:8443',
  currentBaseUrl: 'https://A.example.com:8443/'   // 同源，只是写法不同
});
check('401 地址确认：同源 → 允许删库', staleSame.clearStore, true);
check('401 地址确认：同源 → 才关徽标', staleSame.clearSavedBadge, true);
check('401 地址确认：同源 → sameServerNow', staleSame.sameServerNow, true);
check('401 地址确认：同源 → 清密码框仍无条件', staleSame.clearPassword, true);

const staleCross = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'https://a.example.com',
  currentBaseUrl: 'https://b.example.com'
});
check('401 地址确认：跨站 → 绝不许删库', staleCross.clearStore, false);
check('401 地址确认：跨站 → 徽标必须留着（密文还在本机）', staleCross.clearSavedBadge, false);
check('401 地址确认：跨站 → sameServerNow', staleCross.sameServerNow, false);
check('401 地址确认：跨站 → 不动用户偏好', staleCross.uncheck, false);
check('401 地址确认：跨站 → 不谎称"已失效"', staleCross.showExpiredNotice, false);
check('401 地址确认：跨站 → 但仍清空密码框（那串一定错）', staleCross.clearPassword, true);

// 缺口 1 的地址（无协议两台不同机器）在 401 路径上同样不能判同源
const staleGap1 = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'localhost:8080',
  currentBaseUrl: 'example.com:8080'
});
check('401 地址确认：缺口1 不同机器 → 不删库', staleGap1.clearStore, false);
check('401 地址确认：缺口1 不同机器 → sameServerNow false', staleGap1.sameServerNow, false);

// 子路径反代的两套实例（缺口 2 的地址）同理
const staleSubPath = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'http://host/weknora',
  currentBaseUrl: 'http://host/other'
});
check('401 地址确认：缺口2 同 host 不同实例 → 不删库', staleSubPath.clearStore, false);

// 地址任一侧未知 → **fail-safe：不删**（无法确认这份密文属于当前服务器，
// 而删库不可恢复；宁可让用户重输一次）。fail-open（未知按同源处理）已废弃：
// 那意味着将来任何一次"忘记同步 savedServerUrl"的重构都会静默删掉用户密码。
check(
  '401 地址确认：两侧地址都未知 → fail-safe 不删',
  planStaleCredential({ hadSaved: true }).clearStore,
  false
);
check(
  '401 地址确认：只知保存地址 → fail-safe 不删',
  planStaleCredential({ hadSaved: true, savedServerUrl: 'https://a.example.com' }).clearStore,
  false
);
check(
  '401 地址确认：只知当前地址 → fail-safe 不删',
  planStaleCredential({ hadSaved: true, currentBaseUrl: 'https://a.example.com' }).clearStore,
  false
);
checkTrue(
  '401 地址确认：sameServerNow 恒为 boolean',
  [
    planStaleCredential({}),
    staleSame,
    staleCross
  ].every((plan) => typeof plan.sameServerNow === 'boolean')
);

// 不变式：四个副作用字段必须同源。若将来有人把其中任何一个拆成独立判断，
// 就会出现「删了库却留着徽标」「关了勾选却不删库」这类中间态。
checkTrue(
  '不变式：clearStore / uncheck / showExpiredNotice / clearSavedBadge 四者同源',
  [
    {},
    { hadSaved: true },
    { hadSaved: false },
    { hadSaved: true, savedServerUrl: 'https://a', currentBaseUrl: 'https://a' },
    { hadSaved: true, savedServerUrl: 'https://a', currentBaseUrl: 'https://b' }
  ].every((input) => {
    const plan = planStaleCredential(input);
    return plan.clearStore === plan.uncheck
      && plan.uncheck === plan.showExpiredNotice
      && plan.showExpiredNotice === plan.clearSavedBadge;
  })
);
check('不变式：clearSavedBadge 缺省为 false', planStaleCredential({}).clearSavedBadge, false);

// 场景 A：同源存过（地址完全一致）→ 四项全清
const staleSameExact = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'http://a:8080',
  currentBaseUrl: 'http://a:8080'
});
check('场景A 同源：clearStore', staleSameExact.clearStore, true);
check('场景A 同源：uncheck', staleSameExact.uncheck, true);
check('场景A 同源：showExpiredNotice', staleSameExact.showExpiredNotice, true);
check('场景A 同源：clearSavedBadge', staleSameExact.clearSavedBadge, true);
check('场景A 同源：sameServerNow', staleSameExact.sameServerNow, true);

// 场景 B：跨站 + 本机没存过 b 的密码 → 全不清（连 sameServerNow 都是 false）
const staleCrossNoSaved = planStaleCredential({
  hadSaved: false,
  savedServerUrl: 'http://a:8080',
  currentBaseUrl: 'http://b:8080'
});
check('场景B 跨站且没存过：clearStore', staleCrossNoSaved.clearStore, false);
check('场景B 跨站且没存过：uncheck', staleCrossNoSaved.uncheck, false);
check('场景B 跨站且没存过：showExpiredNotice', staleCrossNoSaved.showExpiredNotice, false);
check('场景B 跨站且没存过：clearSavedBadge', staleCrossNoSaved.clearSavedBadge, false);
check('场景B 跨站且没存过：sameServerNow', staleCrossNoSaved.sameServerNow, false);

// 场景 C：同源回填后用户手动把地址改到 b 再 401 → 密文属于 a，不许因 b 的 401 删掉 a 的密码
const staleAddressChanged = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'http://a:8080',
  currentBaseUrl: 'http://b:8080'
});
check('场景C 改地址后：clearStore', staleAddressChanged.clearStore, false);
check('场景C 改地址后：uncheck', staleAddressChanged.uncheck, false);
check('场景C 改地址后：showExpiredNotice', staleAddressChanged.showExpiredNotice, false);
check('场景C 改地址后：clearSavedBadge（徽标要留着，用户仍可去清除）', staleAddressChanged.clearSavedBadge, false);
check('场景C 改地址后：sameServerNow', staleAddressChanged.sameServerNow, false);
// 场景 E：clearPassword 在所有分支恒为 true —— 上面 C 场景四项全 false，但这条必须还是 true
check('场景E 改地址后：clearPassword 仍为 true', staleAddressChanged.clearPassword, true);

// 场景 D：地址任一侧未知 → **fail-safe 不删**（这是安全默认值的方向选择）
// 曾经的 fail-open（未知按同源处理）是为了兼容"只传 hadSaved 的老调用方"，
// 但那意味着任何一次"忘记同步 savedServerUrl"的重构都会**静默删掉用户密码**（不可恢复）；
// fail-safe 的代价只是"该清的没清，用户重输一次"（可恢复）。
const staleOnlyCurrent = planStaleCredential({
  hadSaved: true,
  savedServerUrl: '',
  currentBaseUrl: 'http://a'
});
check('场景D 只有当前地址：sameServerNow fail-safe 为 false', staleOnlyCurrent.sameServerNow, false);
check('场景D 只有当前地址：不删库', staleOnlyCurrent.clearStore, false);
const staleOnlySaved = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'http://a',
  currentBaseUrl: ''
});
check('场景D 只有保存地址：sameServerNow fail-safe 为 false', staleOnlySaved.sameServerNow, false);
check('场景D 只有保存地址：不删库', staleOnlySaved.clearStore, false);

// 场景 F：归一化差异（尾斜杠 / 默认端口 / 大小写）不影响判定
const staleNormalized = planStaleCredential({
  hadSaved: true,
  savedServerUrl: 'http://a:8080/',
  currentBaseUrl: 'http://A:8080'
});
check('场景F 写法不同但同源：sameServerNow', staleNormalized.sameServerNow, true);
check('场景F 写法不同但同源：clearStore', staleNormalized.clearStore, true);

// ---------------- loginPolicy 的入参容错（挂在登录页交互路径上，不许抛）----------------
const policyNoThrow = [
  ['planSaveToggle()', () => planSaveToggle()],
  ['planSaveToggle(null)', () => planSaveToggle(null)],
  ['planSaveToggle({})', () => planSaveToggle({})],
  ['planStaleCredential()', () => planStaleCredential()],
  ['planStaleCredential(null)', () => planStaleCredential(null)],
  ['planStaleCredential({})', () => planStaleCredential({})]
];
for (const [label, run] of policyNoThrow) {
  let threw = null;
  let out = null;
  try {
    out = run();
  } catch (err) {
    threw = err;
  }
  check(`不抛（${label}）`, threw, null);
  // 注意：typeof null === 'object'，detail 直接写 typeof 会误导成"返回了对象"，
  // 这里显式区分"抛错/无返回"与"返回了非对象"。
  const outKind = out === null || out === undefined ? '抛错或未返回' : typeof out;
  checkTrue(`不抛（${label}）：返回对象`, Boolean(out) && typeof out === 'object', `实际 ${outKind}`);
}
// 无参时按"没勾选 / 没存过"的安全方向退化
check('无参 planSaveToggle：不清库', safe(() => planSaveToggle(), {}).clearStore, false);
check('无参 planSaveToggle：无提示', safe(() => planSaveToggle(), {}).notice, '');
check('无参 planStaleCredential：不动偏好', safe(() => planStaleCredential(), {}).uncheck, false);

console.log(
  failures.length
    ? `\n未通过：${failures.length} 项`
    : `\n全部通过：服务器身份归一化回归测试（${pass} 项）`
);
process.exit(failures.length ? 1 : 0);
