#!/usr/bin/env node
/**
 * 回归测试：问答流的终止语义
 * ---------------------------------------------------------------------------
 * 这个测试锁定一个真实事故：
 *
 *   App 曾用 `if (done) break;` 判断流结束，导致**知识库问答永远收不到回答**。
 *   原因是后端一次问答的**第一个事件**是 agent_query 且 done=true
 *   （用于回放时标注用户问了什么），客户端于是在第一帧就退出，
 *   一个 answer 都没读到，界面显示「未收到回答」。
 *
 * 后端契约（internal/handler/session/helpers.go）：
 *   "The frontend should use 'complete' response_type to detect stream completion"
 *   "Sending an extra empty 'answer' event with done:true causes frontend issues"
 *
 * 用法：node scripts/test-stream-protocol.mjs
 * 退出码：0 通过 / 1 失败
 */
import { isTerminalStreamEvent } from '../src/utils/chatStreamProtocol.js';

// 从 NAS (WeKnora 0.8.0) 实测抓下来的事件序列（只保留类型与 done，不含任何正文）
const RECORDED_STREAM = [
  { response_type: 'agent_query', done: true, contentLen: 0 },
  { response_type: 'tool_call', done: false, contentLen: 30 },
  { response_type: 'tool_result', done: false, contentLen: 0 },
  { response_type: 'references', done: false, contentLen: 0 },
  { response_type: 'answer', done: false, contentLen: 30 },
  { response_type: 'answer', done: false, contentLen: 23 },
  { response_type: 'answer', done: false, contentLen: 29 },
  { response_type: 'answer', done: false, contentLen: 19 },
  { response_type: 'answer', done: false, contentLen: 18 },
  { response_type: 'answer', done: false, contentLen: 12 },
  { response_type: 'complete', done: false, contentLen: 0 }
];

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
};

// --- 1) 终止判定本身 ---
check('complete 是终止事件', isTerminalStreamEvent({ response_type: 'complete' }), true);
check('agent_query + done=true 不是终止事件（事故根因）', isTerminalStreamEvent({ response_type: 'agent_query', done: true }), false);
check('tool_call + done=true 不是终止事件', isTerminalStreamEvent({ response_type: 'tool_call', done: true }), false);
check('references 不是终止事件', isTerminalStreamEvent({ response_type: 'references', done: false }), false);
check('answer 不是终止事件', isTerminalStreamEvent({ response_type: 'answer', done: false }), false);
check('error + done=true 是终止事件', isTerminalStreamEvent({ response_type: 'error', done: true }), true);
check('error 不带 done 不终止', isTerminalStreamEvent({ response_type: 'error', done: false }), false);
check('空值安全', isTerminalStreamEvent(null), false);
check('兼容 type 字段名', isTerminalStreamEvent({ type: 'complete' }), true);

// --- 2) 用真实序列对比"旧逻辑"与"修复后逻辑" ---
function runLoop(events, terminate) {
  let answer = '';
  let brokeAt = null;
  const types = {};
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i];
    const type = e.response_type || e.type;
    types[type] = (types[type] || 0) + 1;
    if (type === 'answer') answer += 'x'.repeat(e.contentLen);
    if (terminate(e)) { brokeAt = i; break; }
  }
  return { answerLen: answer.length, brokeAt, types };
}

const oldBehaviour = runLoop(RECORDED_STREAM, (e) => e.done === true);
check('旧逻辑：在第一帧就退出', oldBehaviour.brokeAt, 0);
check('旧逻辑：一个回答都拿不到（即事故现象）', oldBehaviour.answerLen, 0);
check('旧逻辑：只见到 1 种事件', Object.keys(oldBehaviour.types).length, 1);

const fixed = runLoop(RECORDED_STREAM, isTerminalStreamEvent);
check('修复后：读到 complete 才退出', fixed.brokeAt, RECORDED_STREAM.length - 1);
check('修复后：拿到全部回答内容', fixed.answerLen, 30 + 23 + 29 + 19 + 18 + 12);
check('修复后：answer 事件数正确', fixed.types.answer, 6);
check('修复后：complete 只出现一次', fixed.types.complete, 1);

console.log(failed ? `\n未通过：${failed} 项` : '\n全部通过：终止语义回归测试（14 项）');
process.exit(failed ? 1 : 0);
