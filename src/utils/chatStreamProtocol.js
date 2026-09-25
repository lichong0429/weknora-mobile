// WeKnora 问答流的终止语义。
//
// 背景（真实事故）：App 原来用 `if (done) break;` 判断"流结束"，结果是问答永远收不到回答。
//
// 后端 StreamResponse 的 `done` 字段含义是**"该事件本身已完整"**，不是"整条流结束"。
// 一次问答里第一个事件就是 `agent_query` 且 done=true（用于回放时标注用户问了什么），
// 于是客户端在第一个事件处就 break，一个 answer 都读不到，界面显示「未收到回答」。
//
// 后端源码中的契约（internal/handler/session/helpers.go）：
//   "The frontend should use 'complete' response_type to detect stream completion"
//   "Sending an extra empty 'answer' event with done:true causes frontend issues"
//
// 因此：**只有 `complete` 才是流结束信号**；`error` 带上 done=true 表示服务端已终止本轮，
// 也应当结束（否则会一直等到连接被关闭）。其余事件类型（agent_query / tool_call /
// tool_result / references / thinking …）无论 done 取值都必须继续读。

const TERMINAL_TYPES = new Set(['complete']);

export function isTerminalStreamEvent(evt) {
  if (!evt) return false;
  const type = evt.response_type || evt.type;
  if (TERMINAL_TYPES.has(type)) return true;
  // 错误事件带 done=true → 服务端已放弃本轮，继续等没有意义
  if (type === 'error' && evt.done === true) return true;
  return false;
}

// 便于诊断：把一次流里收到的事件类型汇总成一句话
export function summarizeStreamTypes(types = {}) {
  return Object.entries(types)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${k}×${n}`)
    .join('、') || '无';
}
