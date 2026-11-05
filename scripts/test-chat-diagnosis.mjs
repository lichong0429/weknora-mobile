#!/usr/bin/env node
/**
 * 问答诊断结论的回归测试（纯逻辑，不联网）。
 *
 * 锁定两起真实用户反馈：
 *
 *  1) 诊断卡片自相矛盾 —— 「SSE 帧数: 0（原始字节 0）」与「事件分布：检索改写×1、
 *     工具调用×2、工具结果×1」同屏出现。
 *     成因：frames/bytes 由 chatStream 的 report() 同步，而 report 原先只在 generator
 *     正常走完时调用；后端 429 后直接掐断连接、客户端抛异常时跳过同步，于是它们停在
 *     「只收到响应头」那一刻的 0，而 Chat 侧的事件计数是循环里实时累加的。
 *     → 修复后（client.js 用 try/finally）统计同源；诊断侧再以**事件数**兜底，
 *       只要有事件就不能说「一个字节都没返回」。
 *
 *  2) 结论把用户引向网络 —— 检索已经跑通、断在生成答案阶段的情况，旧文案只说
 *     network error。现在必须判定为「服务端在生成答案阶段中断」，并指出
 *     模型额度不足/被限流（429）、生成超时这类真实成因。
 *
 * 顺带锁定：后端显式 error 事件的优先级不能被我改坏。
 *
 * 用法：node scripts/test-chat-diagnosis.mjs
 * 退出码：0 通过 / 1 失败
 */
import { diagnoseNoAnswer, describeStreamError } from '../src/utils/chatDiagnosis.js';

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

// 一次「流已建立（HTTP 200 + text/event-stream）」的诊断基线
const sseDiag = (patch = {}) => ({
  status: 200,
  contentType: 'text/event-stream',
  frames: 0,
  bytes: 0,
  parseErrors: 0,
  sampleRaw: '',
  requestId: '',
  ...patch
});

// ---------------- 1) 事故复现：0 字节 + 有事件分布 ----------------
// frames/bytes 是「异常路径下停在 0」的旧值，事件计数是客户端真实收到的
const incidentEvents = {
  types: { agent_query: 1, tool_call: 2, tool_result: 1 },
  finishReason: '',
  errorMessage: '',
  sawComplete: false,
  interrupted: true
};
const incident = diagnoseNoAnswer(sseDiag(), incidentEvents);

checkTrue(
  '事故场景：不再说「一个字节都没返回」',
  !incident.verdict.includes('一个字节都没返回'),
  `verdict=${incident.verdict}`
);
checkTrue(
  '事故场景：结论里带上真实事件数',
  incident.verdict.includes('收到 4 个事件'),
  `verdict=${incident.verdict}`
);
checkTrue(
  '事故场景：点明断在生成答案阶段',
  incident.verdict.includes('生成答案'),
  `verdict=${incident.verdict}`
);
checkTrue(
  '事故场景：明确指出没有 answer 事件',
  incident.verdict.includes('没有任何 answer 事件'),
  `verdict=${incident.verdict}`
);
check('事故场景：归因到服务端而非网络', incident.level, 'backend');
checkTrue(
  '事故场景：action 提到额度/限流（429）',
  incident.action.includes('429') && incident.action.includes('额度'),
  `action=${incident.action}`
);
checkTrue(
  '事故场景：action 提到换模型（可操作）',
  incident.action.includes('换用其他模型'),
  `action=${incident.action}`
);
checkTrue(
  '事故场景：证据里仍保留事件分布',
  incident.detail.some((d) => d.includes('检索改写×1') && d.includes('工具调用×2')),
  JSON.stringify(incident.detail)
);

// ---------------- 2) 确实零数据时才可以说零数据 ----------------
const reallyEmpty = diagnoseNoAnswer(sseDiag(), { types: {} });
checkTrue(
  '真空流：才说「一个字节都没返回」',
  reallyEmpty.verdict.includes('一个字节都没返回'),
  `verdict=${reallyEmpty.verdict}`
);
check('真空流：级别为 stream', reallyEmpty.level, 'stream');

// 零事件但客户端侧被中断 → 措辞要区分「连接在返回任何数据前断了」
const interruptedEmpty = diagnoseNoAnswer(sseDiag(), { types: {}, interrupted: true });
checkTrue(
  '断在首个事件之前：措辞不同且同样不提"字节"作为主因',
  interruptedEmpty.verdict.includes('中断'),
  `verdict=${interruptedEmpty.verdict}`
);

// ---------------- 3) 有事件、无 answer、但没被中断（流自己停在半路）----------------
const silentBreakEvents = {
  types: { agent_query: 1, tool_call: 1, tool_result: 1, references: 1 },
  finishReason: '',
  errorMessage: '',
  sawComplete: false,
  interrupted: false
};
const silentBreak = diagnoseNoAnswer(sseDiag({ frames: 4, bytes: 512 }), silentBreakEvents);
checkTrue(
  '流停在半路：不再说零数据，而是报事件数',
  !silentBreak.verdict.includes('一个字节都没返回'),
  `verdict=${silentBreak.verdict}`
);
checkTrue(
  '流停在半路：结论含事件数与「没有 answer」',
  silentBreak.verdict.includes('4 个事件') && silentBreak.verdict.includes('answer'),
  `verdict=${silentBreak.verdict}`
);

// ---------------- 4) 后端显式 error 事件优先级不能被改坏 ----------------
const errorFirst = diagnoseNoAnswer(sseDiag({ frames: 2, bytes: 200 }), {
  types: { error: 1, agent_query: 1 },
  errorMessage: '已达到 Token Plan 用量上限 (2056)',
  interrupted: true
});
check('error 事件优先级：先判后端错误', errorFirst.level, 'backend');
checkTrue(
  'error 事件优先级：原样带出服务端消息',
  errorFirst.verdict.includes('已达到 Token Plan 用量上限 (2056)'),
  `verdict=${errorFirst.verdict}`
);

// ---------------- 5) 正常结束但没有回答内容 ----------------
const completeNoAnswer = diagnoseNoAnswer(sseDiag({ frames: 3, bytes: 300 }), {
  types: { agent_query: 1, complete: 1 },
  sawComplete: true
});
check('正常结束无回答：级别 empty', completeNoAnswer.level, 'empty');
checkTrue(
  '正常结束无回答：结论是"正常结束但没有内容"',
  completeNoAnswer.verdict.includes('正常结束了本轮'),
  `verdict=${completeNoAnswer.verdict}`
);

// ---------------- 6) finish_reason=incomplete 也归到生成阶段中断 ----------------
const incompleteDiag = diagnoseNoAnswer(sseDiag({ frames: 3, bytes: 300 }), {
  types: { agent_query: 1, tool_call: 1 },
  finishReason: 'incomplete'
});
checkTrue(
  'incomplete：判定为生成阶段中断',
  incompleteDiag.verdict.includes('生成答案') || incompleteDiag.verdict.includes('incomplete'),
  `verdict=${incompleteDiag.verdict}`
);
checkTrue(
  'incomplete：不再只说"检查后端到模型的网络"',
  !incompleteDiag.action.includes('后端到模型服务的网络与超时设置'),
  `action=${incompleteDiag.action}`
);

// ---------------- 6b) 答案吐到一半断网：不能再声称"没有任何 answer 事件" ----------------
// 可达路径：Chat 的 catch 无条件调 diagnoseNoAnswer，此时 types.answer > 0 会把
// 「生成阶段中断」那条挡掉，落到最后一条兜底 —— 旧文案与气泡里的半截答案冲突。
const halfAnswer = diagnoseNoAnswer(sseDiag({ frames: 5, bytes: 500 }), {
  types: { answer: 5 },
  interrupted: true
});
checkTrue(
  '半截答案：不再说「没有任何 answer 事件」',
  !halfAnswer.verdict.includes('没有任何 answer 事件'),
  `verdict=${halfAnswer.verdict}`
);
checkTrue(
  '半截答案：文案提到回答不完整/被截断',
  halfAnswer.verdict.includes('不完整') || halfAnswer.verdict.includes('截断'),
  `verdict=${halfAnswer.verdict}`
);
checkTrue(
  '半截答案：说明已收到的 answer 段数',
  halfAnswer.verdict.includes('5 段回答内容'),
  `verdict=${halfAnswer.verdict}`
);
checkTrue(
  '半截答案：action 是可执行的重试，而不是"去诊断页自检"',
  halfAnswer.action.includes('重试') && !halfAnswer.action.includes('问答链路自检'),
  `action=${halfAnswer.action}`
);

// ---------------- 6c) 真实 429 不能被判成「代理改写响应」 ----------------
// client.js 在 !res.ok 抛错前已 report 了 status，所以这种「流没开 + JSON 错误体」
// 的诊断里 status=429；若 429 没有专门分支，会被 content-type 分支抢走。
const rateLimitedStream = diagnoseNoAnswer(
  { status: 429, contentType: 'application/json', frames: 0, bytes: 0, sampleRaw: '{"error":{"message":"rate limit"}}' },
  { types: {}, interrupted: true }
);
check('HTTP 429：级别为后端', rateLimitedStream.level, 'backend');
checkTrue(
  'HTTP 429：结论指向限流/额度，不是代理',
  rateLimitedStream.verdict.includes('429') && !rateLimitedStream.verdict.includes('不是流式'),
  `verdict=${rateLimitedStream.verdict}`
);
checkTrue(
  'HTTP 429：不把用户引去查网关',
  !rateLimitedStream.action.includes('反向代理'),
  `action=${rateLimitedStream.action}`
);
checkTrue(
  'HTTP 429：给出换模型的建议',
  rateLimitedStream.action.includes('换用其他'),
  `action=${rateLimitedStream.action}`
);
checkTrue(
  'HTTP 429：说明请求没进入生成阶段',
  rateLimitedStream.verdict.includes('生成阶段'),
  `verdict=${rateLimitedStream.verdict}`
);

// 非 429 的非流式响应仍应判给代理
const proxied = diagnoseNoAnswer(
  { status: 200, contentType: 'text/html', frames: 0, bytes: 0, sampleRaw: '<html>' },
  { types: {} }
);
checkTrue(
  'HTTP 200 + HTML：仍判为代理改写',
  proxied.verdict.includes('不是流式'),
  `verdict=${proxied.verdict}`
);

// ---------------- 6d) 诊断本身不能抛错（调用方传 null） ----------------
let crashed = null;
let nullSafe = null;
try {
  nullSafe = diagnoseNoAnswer(null, null);
} catch (e) {
  crashed = e;
}
check('传 null：不抛错', crashed, null);
check('传 null：仍给出兜底结论', nullSafe && nullSafe.level, 'network');

// ---------------- 7) 客户端异常文案友好化 ----------------
const aborted = describeStreamError(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
check('AbortError：归类为主动停止', aborted.kind, 'aborted');

const netErr = describeStreamError(new TypeError('Failed to fetch'));
check('Failed to fetch：归类为连接中断', netErr.kind, 'network');
checkTrue(
  'Failed to fetch：不直接抛英文原文',
  !netErr.message.includes('Failed to fetch'),
  `message=${netErr.message}`
);
checkTrue(
  'Failed to fetch：提示里带上可能的服务端成因',
  netErr.message.includes('429'),
  `message=${netErr.message}`
);

const rateLimited = describeStreamError(new Error('HTTP 429'));
check('HTTP 429：归类为限流/额度', rateLimited.kind, 'rate-limit');
checkTrue(
  'HTTP 429：给出可操作建议',
  rateLimited.message.includes('换用其他问答模型'),
  `message=${rateLimited.message}`
);

const serverError = describeStreamError(new Error('HTTP 502'));
check('HTTP 5xx：归类为服务端错误', serverError.kind, 'server');

// 代码 bug 不能被误报成网络问题（否则更难排查）
const codeBug = describeStreamError(new TypeError("Cannot read properties of undefined (reading 'x')"));
check('普通 TypeError（代码 bug）：不归类为网络', codeBug.kind, 'unknown');
check('WebView 内核断连：归类为网络', describeStreamError(new TypeError('net::ERR_CONNECTION_RESET')).kind, 'network');

// 真实断连串里带 aborted 字样，不能被当成「用户主动停止」
const connAborted = describeStreamError(new TypeError('net::ERR_CONNECTION_ABORTED'));
check('ERR_CONNECTION_ABORTED：归类为网络而非主动停止', connAborted.kind, 'network');
checkTrue(
  'ERR_CONNECTION_ABORTED：不再显示「已停止生成」',
  !connAborted.message.includes('已停止生成'),
  `message=${connAborted.message}`
);
// 反向：用户主动停止不能被改坏
const userAbort = describeStreamError(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
check('用户主动停止：仍归类为 aborted', userAbort.kind, 'aborted');
check('用户主动停止：文案仍是「已停止生成」', userAbort.message, '已停止生成。');
check('fetch 的 abort 消息：仍归类为主动停止', describeStreamError(new DOMException('The user aborted a request.', 'AbortError')).kind, 'aborted');

const passthrough = describeStreamError(new Error('已达到 Token Plan 用量上限 (2056)'));
check('服务端中文原因：原样透出', passthrough.message, '已达到 Token Plan 用量上限 (2056)');

const unknown = describeStreamError(null);
check('空异常：不崩且给出兜底文案', unknown.kind, 'unknown');

console.log(
  failures.length
    ? `\n未通过：${failures.length} 项`
    : `\n全部通过：问答诊断回归测试（${pass} 项）`
);
process.exit(failures.length ? 1 : 0);
