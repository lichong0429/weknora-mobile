#!/usr/bin/env node
/**
 * 「保存登录密码」安全存储封装的回归测试（纯逻辑，不联网、不依赖 Android）。
 *
 * 被测对象：src/utils/secureStore.js —— 它把 MainActivity.Bridge 里
 * saveCredentials / loadCredentials / clearCredentials 三个同步返回 JSON 字符串的
 * 原生方法包成 Promise。
 *
 * 这份测试锁定的是「出错时也不能出事」的那几条路径：
 *   1) 正常往返：save 的数据能原样 load 回来；
 *   2) EMPTY 是正常状态（从没保存过）而不是故障，不能被当成错误弹红色提示；
 *   3) 桥返回空串 / 非 JSON 时 → BAD_INPUT，且**不抛异常**（否则 React 里会白屏）；
 *   4) DECRYPT_FAILED 必须透出，lastCode 也要能被 UI 读到（决定「请重新输入」文案）；
 *   5) 浏览器（无桥）→ isAvailable() false，三个方法都 UNAVAILABLE，且不抛；
 *   6) 入参校验：缺字段 / 空字符串 → BAD_INPUT，绝不把半份凭据发到原生；
 *   7) **零 localStorage 写入** —— 这是硬红线：任何情况下都不能把密码落到
 *      明文 localStorage（DevTools / 备份都能读走）；
 *   8) 桥方法抛异常（模拟 WebView 页面销毁时的 Java 抛错）→ UNAVAILABLE，不崩。
 *
 * 用法：node scripts/test-secure-store.mjs
 * 退出码：0 通过 / 1 失败
 */

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

// ---------------- 测试环境准备 ----------------
// 记录型 localStorage：本封装**不应**有任何写入（第 7 组断言）。
// 必须在 import 之前装好，才能捕获模块加载期的意外写入。
const localStore = new Map();
const localWrites = [];
globalThis.localStorage = {
  getItem(k) {
    return localStore.has(k) ? localStore.get(k) : null;
  },
  setItem(k, v) {
    localWrites.push(['setItem', k, v]);
    localStore.set(k, String(v));
  },
  removeItem(k) {
    localWrites.push(['removeItem', k]);
    localStore.delete(k);
  },
  clear() {
    localWrites.push(['clear']);
    localStore.clear();
  },
  key(i) {
    return [...localStore.keys()][i] ?? null;
  },
  get length() {
    return localStore.size;
  }
};

// 浏览器默认形态：有 window，没有 WeKnoraBridge
globalThis.window = {};

const store = await import('../src/utils/secureStore.js');

/** 装一个假的原生桥；impl 决定返回值/抛错行为 */
function setBridge(impl) {
  globalThis.window = { WeKnoraBridge: impl };
}

/** 卸掉桥，模拟普通浏览器 */
function clearBridge() {
  globalThis.window = {};
}

/** 一个行为正常的假桥：内存里存 JSON 字符串，解密永远成功 */
function happyBridge() {
  let saved = null;
  return {
    saveCredentials(json) {
      try {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed.email !== 'string' || !parsed.email
          || typeof parsed.password !== 'string' || !parsed.password
          || typeof parsed.baseUrl !== 'string' || !parsed.baseUrl) {
          return JSON.stringify({ ok: false, code: 'BAD_INPUT', message: '参数不全' });
        }
        saved = json;
        return JSON.stringify({ ok: true, data: parsed });
      } catch {
        return JSON.stringify({ ok: false, code: 'BAD_INPUT', message: '参数不是合法 JSON' });
      }
    },
    loadCredentials() {
      if (!saved) return JSON.stringify({ ok: false, code: 'EMPTY', message: '尚未保存登录信息' });
      return JSON.stringify({ ok: true, data: JSON.parse(saved) });
    },
    clearCredentials() {
      saved = null;
      return JSON.stringify({ ok: true });
    }
  };
}

const cred = {
  email: 'someone@example.com',
  password: 'p@ss w0rd-测试',
  baseUrl: 'https://demo.example.com'
};

// ---------------- 1) 有桥：save → load 往返一致 ----------------
setBridge(happyBridge());
check('可用性：有桥时 isAvailable() 为 true', store.isAvailable(), true);

const saved = await store.save(cred);
check('往返：save 成功返回 {ok:true}', saved, { ok: true });

const loaded = await store.load();
check('往返：load 成功', loaded.ok, true);
check('往返：email 一致', loaded.data && loaded.data.email, cred.email);
check('往返：password 一致（含空格与中文）', loaded.data && loaded.data.password, cred.password);
check('往返：baseUrl 一致', loaded.data && loaded.data.baseUrl, cred.baseUrl);
check('往返：成功后 lastCode 为空', store.lastCode, '');

// 清掉之后应回到 EMPTY
const cleared = await store.clear();
check('clear：成功返回 {ok:true}', cleared, { ok: true });
const afterClear = await store.load();
check('clear 之后 load：返回 EMPTY', { ok: afterClear.ok, code: afterClear.code }, { ok: false, code: 'EMPTY' });

// ---------------- 2) 有桥：load 返回 EMPTY 正确透出 ----------------
setBridge({
  saveCredentials: () => JSON.stringify({ ok: true }),
  loadCredentials: () => JSON.stringify({ ok: false, code: 'EMPTY' }),
  clearCredentials: () => JSON.stringify({ ok: true })
});
const emptyRes = await store.load();
check('EMPTY：ok 为 false', emptyRes.ok, false);
check('EMPTY：code 透出', emptyRes.code, 'EMPTY');
check('EMPTY：lastCode 同步更新', store.lastCode, 'EMPTY');

// ---------------- 3) 有桥：非法 JSON / 空串 → BAD_INPUT，不抛 ----------------
const garbageReturns = [
  ['非法 JSON', '{not json'],
  ['空串', ''],
  ['纯空白', '   \n\t '],
  ['JSON 但非对象', '42'],
  ['JSON 数组', '[{"ok":true}]'],
  ['undefined 返回', undefined],
  ['null 返回', null],
  ['数字返回', 123]
];

for (const [label, ret] of garbageReturns) {
  setBridge({
    saveCredentials: () => ret,
    loadCredentials: () => ret,
    clearCredentials: () => ret
  });
  let threw = null;
  let res = null;
  try {
    res = await store.save(cred);
  } catch (err) {
    threw = err;
  }
  check(`容错（${label}）：save 不抛异常`, threw, null);
  check(`容错（${label}）：save 返回 BAD_INPUT`, { ok: res && res.ok, code: res && res.code }, { ok: false, code: 'BAD_INPUT' });

  let threwLoad = null;
  let loadRes = null;
  try {
    loadRes = await store.load();
  } catch (err) {
    threwLoad = err;
  }
  check(`容错（${label}）：load 不抛异常`, threwLoad, null);
  check(`容错（${label}）：load 返回 BAD_INPUT`, loadRes && loadRes.code, 'BAD_INPUT');
}

// 原生说 ok:true 但 data 缺字段 —— 不能拿半份凭据去登录
setBridge({
  saveCredentials: () => JSON.stringify({ ok: true }),
  loadCredentials: () => JSON.stringify({ ok: true, data: { email: 'a@b.c' } }),
  clearCredentials: () => JSON.stringify({ ok: true })
});
const partial = await store.load();
check('data 缺字段：不当作成功', partial.ok, false);
check('data 缺字段：返回 BAD_INPUT', partial.code, 'BAD_INPUT');

// ---------------- 4) 有桥：DECRYPT_FAILED 正确透出，lastCode 可读 ----------------
setBridge({
  saveCredentials: () => JSON.stringify({ ok: true }),
  loadCredentials: () => JSON.stringify({
    ok: false,
    code: 'DECRYPT_FAILED',
    message: '已保存的登录信息无法解密（可能重装过应用或系统重置了密钥），已清除，请重新输入'
  }),
  clearCredentials: () => JSON.stringify({ ok: true })
});
const decryptFailed = await store.load();
check('DECRYPT_FAILED：ok 为 false', decryptFailed.ok, false);
check('DECRYPT_FAILED：code 透出', decryptFailed.code, 'DECRYPT_FAILED');
check('DECRYPT_FAILED：lastCode 可读', store.lastCode, 'DECRYPT_FAILED');
checkTrue(
  'DECRYPT_FAILED：message 原样带出（含"重新输入"）',
  typeof decryptFailed.message === 'string' && decryptFailed.message.includes('重新输入'),
  `message=${decryptFailed.message}`
);
check('DECRYPT_FAILED：getLastCode() 与活绑定一致', store.getLastCode(), 'DECRYPT_FAILED');

// 未知 code（原生改了枚举）不能被当成成功，也不该透出未定义值
setBridge({
  saveCredentials: () => JSON.stringify({ ok: false, code: 'SOMETHING_NEW', message: 'x' }),
  loadCredentials: () => JSON.stringify({ ok: true }),
  clearCredentials: () => JSON.stringify({ ok: true })
});
const unknownCode = await store.save(cred);
check('未知 code：不当作成功', unknownCode.ok, false);
check('未知 code：归一化为 BAD_INPUT', unknownCode.code, 'BAD_INPUT');

// ---------------- 5) 无桥（浏览器）：全部 UNAVAILABLE，不抛 ----------------
clearBridge();
check('无桥：isAvailable() 为 false', store.isAvailable(), false);

let noBridgeThrew = null;
let noBridgeResults = null;
try {
  noBridgeResults = {
    save: await store.save(cred),
    load: await store.load(),
    clear: await store.clear()
  };
} catch (err) {
  noBridgeThrew = err;
}
check('无桥：三个方法都不抛异常', noBridgeThrew, null);
check('无桥：save 返回 UNAVAILABLE', noBridgeResults && noBridgeResults.save.code, 'UNAVAILABLE');
check('无桥：load 返回 UNAVAILABLE', noBridgeResults && noBridgeResults.load.code, 'UNAVAILABLE');
check('无桥：clear 返回 UNAVAILABLE', noBridgeResults && noBridgeResults.clear.code, 'UNAVAILABLE');
check('无桥：save 的 ok 为 false', noBridgeResults && noBridgeResults.save.ok, false);
check('无桥：lastCode 为 UNAVAILABLE', store.lastCode, 'UNAVAILABLE');

// 桥对象残缺（只实现了 download）也算不可用，不能半残地报错
globalThis.window = { WeKnoraBridge: { download: () => {} } };
check('残缺桥：isAvailable() 为 false', store.isAvailable(), false);
const brokenBridgeRes = await store.save(cred);
check('残缺桥：save 返回 UNAVAILABLE', brokenBridgeRes.code, 'UNAVAILABLE');

// ---------------- 6) 入参校验：BAD_INPUT ----------------
setBridge(happyBridge());
const badInputs = [
  ['null', null],
  ['undefined', undefined],
  ['字符串', 'email=someone@example.com'],
  ['数组', []],
  ['空对象', {}],
  ['缺 email', { password: 'x', baseUrl: cred.baseUrl }],
  ['缺 password', { email: cred.email, baseUrl: cred.baseUrl }],
  ['缺 baseUrl', { email: cred.email, password: 'x' }],
  ['email 空串', { email: '', password: 'x', baseUrl: cred.baseUrl }],
  ['password 空串', { email: cred.email, password: '', baseUrl: cred.baseUrl }],
  ['baseUrl 空串', { email: cred.email, password: 'x', baseUrl: '' }],
  ['baseUrl 纯空白', { email: cred.email, password: 'x', baseUrl: '   ' }],
  ['password 非字符串', { email: cred.email, password: 12345, baseUrl: cred.baseUrl }],
  ['email 非字符串', { email: null, password: 'x', baseUrl: cred.baseUrl }]
];

for (const [label, bad] of badInputs) {
  let threw = null;
  let res = null;
  try {
    res = await store.save(bad);
  } catch (err) {
    threw = err;
  }
  check(`入参校验（${label}）：不抛异常`, threw, null);
  check(`入参校验（${label}）：BAD_INPUT`, res && res.code, 'BAD_INPUT');
}

// 边界：password 只有空格，是合法密码（不能因为 trim 判空被误拒）
const spacePassword = await store.save({
  email: cred.email,
  password: '   ',
  baseUrl: cred.baseUrl
});
check('入参校验：只由空格组成的密码被接受', spacePassword, { ok: true });

// email / baseUrl 首尾空白会被裁掉，密码保持原样
setBridge({
  saveCredentials(json) {
    return JSON.stringify({ ok: true, data: JSON.parse(json) });
  },
  loadCredentials: () => JSON.stringify({ ok: false, code: 'EMPTY' }),
  clearCredentials: () => JSON.stringify({ ok: true })
});
await store.save({ email: '  a@b.c  ', password: ' p ', baseUrl: '  https://x.example  ' });
// 上面这次 save 的入参已被裁剪，这里用一个探针桥验证序列化结果
let captured = '';
setBridge({
  saveCredentials(json) {
    captured = json;
    return JSON.stringify({ ok: true });
  },
  loadCredentials: () => JSON.stringify({ ok: false, code: 'EMPTY' }),
  clearCredentials: () => JSON.stringify({ ok: true })
});
await store.save({ email: '  a@b.c  ', password: ' p ', baseUrl: '  https://x.example  ' });
check('裁剪：email 去首尾空白', JSON.parse(captured).email, 'a@b.c');
check('裁剪：baseUrl 去首尾空白', JSON.parse(captured).baseUrl, 'https://x.example');
check('裁剪：password 原样保留', JSON.parse(captured).password, ' p ');

// ---------------- 7) 红线：绝不写 localStorage ----------------
check('红线：localStorage 零写入', localWrites, []);

// ---------------- 8) 桥方法抛异常 → UNAVAILABLE，不崩 ----------------
// WebView 页面销毁 / 桥被移除时，Java 侧可能抛
// "Error: Java exception was raised during method call"
setBridge({
  saveCredentials() {
    throw new Error('Error: Java exception was raised during method call');
  },
  loadCredentials() {
    throw new Error('Error: Java exception was raised during method call');
  },
  clearCredentials() {
    throw new Error('Error: Java exception was raised during method call');
  }
});
let throwThrew = null;
let throwRes = null;
try {
  throwRes = {
    save: await store.save(cred),
    load: await store.load(),
    clear: await store.clear()
  };
} catch (err) {
  throwThrew = err;
}
check('桥抛异常：三个方法都不把异常抛出去', throwThrew, null);
check('桥抛异常：save 返回 UNAVAILABLE', throwRes && throwRes.save.code, 'UNAVAILABLE');
check('桥抛异常：load 返回 UNAVAILABLE', throwRes && throwRes.load.code, 'UNAVAILABLE');
check('桥抛异常：clear 返回 UNAVAILABLE', throwRes && throwRes.clear.code, 'UNAVAILABLE');
checkTrue(
  '桥抛异常：message 带出原始信息（便于诊断）',
  throwRes && typeof throwRes.save.message === 'string' && throwRes.save.message.includes('Java exception'),
  `message=${throwRes && throwRes.save.message}`
);
check('桥抛异常：最后仍然没有写 localStorage', localWrites, []);

// 桥属性取值本身抛异常（代理陷阱）也不能崩
globalThis.window = {
  get WeKnoraBridge() {
    throw new Error('unexpected getter');
  }
};
check('桥 getter 抛错：isAvailable() 返回 false 而不是崩', store.isAvailable(), false);
const getterRes = await store.load();
check('桥 getter 抛错：load 返回 UNAVAILABLE', getterRes.code, 'UNAVAILABLE');

// ---------------- 9) 无 window 环境（SSR / 单元测试）----------------
delete globalThis.window;
check('无 window：isAvailable() 为 false', store.isAvailable(), false);
const noWindowRes = await store.save(cred);
check('无 window：save 返回 UNAVAILABLE', noWindowRes.code, 'UNAVAILABLE');

console.log(
  failures.length
    ? `\n未通过：${failures.length} 项`
    : `\n全部通过：安全存储封装回归测试（${pass} 项）`
);
process.exit(failures.length ? 1 : 0);
