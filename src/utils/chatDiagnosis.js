// 问答失败的证据化判定。
//
// 背景：旧版在「没收到回答」时只给三句猜测 —— ①后端未配置大模型 ②知识库无相关内容
// ③网络异常。这三条无法互斥，用户既不能确认也不能排除，等于没有诊断价值。
//
// 这里按「实际收到了什么」给出**唯一结论**。判定顺序很关键：从最早出问题的环节
// 往后排，先命中先返回，避免把"流根本没开"误判成"后端没配模型"。
//
// 输入：
//   diag   chatStream 的 onMeta 诊断（status / contentType / frames / bytes / parseErrors / sampleRaw）
//   events 客户端侧统计（各 response_type 计数、finish_reason、error 内容、是否收到 complete、
//          以及 interrupted —— 客户端侧的流是被异常中断的，不是用户点「停止」）
// 输出：
//   { level: 'auth'|'network'|'stream'|'backend'|'empty'|'none', verdict, detail[], action }
import { getConfig } from '../config.js';
import { resolveAuthMode, AUTH_MODE_ACCOUNT } from './auth.js';

const TYPE_LABELS = {
  answer: '回答内容',
  references: '引用片段',
  thinking: '思考过程',
  reflection: '反思',
  complete: '流结束标记',
  error: '错误事件',
  session_title: '会话标题',
  tool_call: '工具调用',
  tool_result: '工具结果',
  agent_query: '检索改写',
  artifacts_pending: '产物',
  steer: '插话',
  user_message_injected: '插话回显',
  memory_recalled: '记忆召回'
};

function describeTypes(types = {}) {
  const parts = Object.entries(types)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${TYPE_LABELS[k] || k}×${n}`);
  return parts.length ? parts.join('、') : '无';
}

export function diagnoseNoAnswer(diag = {}, events = {}) {
  // 兜底：诊断本身绝不能抛错 —— 否则「没收到回答」会升级成「页面渲染报错」，
  // 用户连诊断卡片都看不到（默认值只覆盖 undefined，不覆盖 null）。
  diag = diag || {};
  events = events || {};
  const {
    status = 0,
    contentType = '',
    frames = 0,
    bytes = 0,
    parseErrors = 0,
    sampleRaw = '',
    requestId = ''
  } = diag;

  const detail = [
    `HTTP 状态：${status || '未取得响应'}`,
    `响应类型：${contentType || '—'}`,
    `SSE 帧数：${frames}（原始字节 ${bytes}）`,
    `事件分布：${describeTypes(events.types)}`,
    events.finishReason ? `finish_reason：${events.finishReason}` : null,
    parseErrors > 0 ? `JSON 解析失败帧：${parseErrors}` : null,
    sampleRaw ? `响应样本：${String(sampleRaw).slice(0, 200)}` : null,
    requestId ? `请求 ID：${requestId}` : null
  ].filter(Boolean);

  const done = { detail, requestId };

  const types = events.types || {};
  // 「到底有没有数据回来」必须以**事件数**为准，不能只看 frames/bytes：
  // frames/bytes 由 chatStream 侧统计，异常路径上它可能比客户端侧的事件计数滞后
  // （真实事故：后端 429 掐断流时卡片显示「0 字节」却同时列出「检索改写×1、工具调用×2」）。
  // 两份证据口径统一后，才不会出现自相矛盾的结论。
  const eventTotal = Object.keys(types).reduce((n, k) => n + (types[k] || 0), 0);
  const hasAnswerEvent = (types.answer || 0) > 0;
  // 检索改写 / 工具调用 / 工具结果 —— 这三类事件证明「检索阶段是通的」
  const hasProgressEvent =
    (types.agent_query || 0) > 0 || (types.tool_call || 0) > 0 || (types.tool_result || 0) > 0;

  // 1) 请求根本没发出去（离线 / 地址不可达）
  if (!status) {
    return {
      ...done,
      level: 'network',
      verdict: '请求没能建立连接，或中途被中断。',
      action: '检查手机网络，以及设置里的服务器地址是否可达（可在「诊断」页先跑一键测试）。'
    };
  }

  // 2) 鉴权失败：凭据无效、或缺少问答能力（后端对 /knowledge-chat 要求 chat 权限）
  if (status === 401 || status === 403) {
    // 账号模式与 API Key 模式的成因完全不同，混着说会把账号用户引到「更新 API Key」这个
    // 他根本没有、也不该去改的地方
    const accountMode = resolveAuthMode(getConfig()) === AUTH_MODE_ACCOUNT;
    return {
      ...done,
      level: 'auth',
      verdict: accountMode
        ? `鉴权失败（HTTP ${status}）。登录已失效或该账号没有问答权限。`
        : `鉴权失败（HTTP ${status}）。API Key 无效，或该 Key 没有问答权限。`,
      action: accountMode
        ? '到设置页「登录状态」重新登录；若确认账号有权限，检查服务端是否开启了注册/登录限制。'
        : '到设置页更新 API Key；若 Key 是「知识库受限」类型，需要换成有问答权限的 Key。'
    };
  }

  // 2.5) 限流 / 模型额度用尽。必须排在「响应不是流式」之前：
  //      429 通常就是 JSON 错误体（client.js 在 !res.ok 抛错前已 report 了 status
  //      与 contentType），否则会被误判成「反向代理改写响应」—— 恰好把真正的原因藏起来，
  //      而这正是本次用户遇到的情况。
  if (status === 429) {
    return {
      ...done,
      level: 'backend',
      verdict: `服务端限流或模型额度已用尽（HTTP 429），本次请求没有进入生成阶段${sampleRaw ? `：${String(sampleRaw).slice(0, 160)}` : '。'}`,
      action: '到模型服务控制台确认额度/套餐是否用尽，或换用其他问答模型后重试。'
    };
  }

  // 3) 路由 / 版本不匹配
  if (status === 404 || status === 405) {
    return {
      ...done,
      level: 'backend',
      verdict: `问答接口不存在（HTTP ${status}）。后端版本与 App 期望的接口不一致。`,
      action: '确认后端为 WeKnora 且已开启会话问答；接口路径应为 POST /api/v1/knowledge-chat/{session_id}。'
    };
  }

  // 4) 后端自己的错误（含 5xx）
  if (status >= 500) {
    return {
      ...done,
      level: 'backend',
      verdict: `后端返回 ${status}，问题在服务端。`,
      action: '查看后端日志；若提示模型相关错误，优先检查大语言模型是否配置、额度是否用尽。'
    };
  }

  // 5) 返回的不是 SSE 流（多半是网关/代理改写或返回了 JSON 错误）
  if (contentType && !contentType.includes('text/event-stream') && !contentType.includes('application/octet-stream')) {
    return {
      ...done,
      level: 'stream',
      verdict: `响应不是流式（Content-Type: ${contentType}），说明请求没走到问答处理器。`,
      action: '通常是反向代理改写了响应。检查 NAS/网关是否对 /api/v1/knowledge-chat 做了缓冲或拦截。'
    };
  }

  // 6) 收到了帧但一帧都解析不了（代理注入了非 JSON 内容）
  if (parseErrors > 0 && frames === parseErrors) {
    return {
      ...done,
      level: 'stream',
      verdict: `收到 ${frames} 帧但全部无法解析为 JSON，响应体不是后端的事件格式。`,
      action: '多为代理注入错误页。对照上面的「响应样本」，若为 HTML 或纯文本即为代理问题。'
    };
  }

  // 7) 流开了但确实没有任何数据回来
  //    三个口径（事件数 / 帧数 / 字节数）全为 0 才允许说"一个字节都没返回"——
  //    只要有事件回来，即使 frames/bytes 曾因统计时机显示为 0，也不能下这个结论。
  if (eventTotal === 0 && frames === 0 && bytes === 0) {
    return {
      ...done,
      level: 'stream',
      verdict: events.interrupted
        ? '流已建立，但连接在服务端返回任何数据之前就中断了。'
        : '流已建立，但服务端一个字节都没返回。',
      action: '常见于反向代理缓冲请求、或上游模型长时间无输出后被超时切断。可先在网页端用同一知识库提问对照。'
    };
  }

  // 8) 后端显式报错
  if (events.types?.error > 0 || events.errorMessage) {
    return {
      ...done,
      level: 'backend',
      verdict: `后端返回错误事件：${events.errorMessage || '（未携带内容）'}`,
      action: '该消息来自服务端，按它提示的原因处理（模型未配置 / 调用失败 / 额度等）。'
    };
  }

  // 9) 收到了过程事件（检索改写 / 工具调用 / 工具结果），却没有任何 answer，
  //    且客户端侧是被异常中断的（不是用户点「停止」）→ 断点在**服务端的生成答案阶段**。
  //    这条必须排在「网络」类结论之前给出：检索阶段已经跑通，说明网络与鉴权都是好的，
  //    此前把这类情况归结为 network error，会把用户引去改网络设置，而真正该查的是模型。
  if (!hasAnswerEvent && eventTotal > 0 && (events.interrupted || events.finishReason === 'incomplete')) {
    return {
      ...done,
      level: 'backend',
      verdict: events.interrupted
        ? `收到 ${eventTotal} 个事件（${describeTypes(types)}）${hasProgressEvent ? '，检索已跑通' : ''}，`
          + '但没有任何 answer 事件 —— 连接在生成答案阶段被断开。'
        : `收到 ${eventTotal} 个事件（${describeTypes(types)}）${hasProgressEvent ? '，检索已跑通' : ''}，`
          + '但没有任何 answer 事件，流在结束标记之前中断（finish_reason=incomplete）。',
      action:
        '检索与工具调用都完成了，断在「让模型生成答案」这一步，通常不是手机网络问题。'
        + '常见原因：模型额度不足或被限流（如 429 Too Many Requests）、后端生成超时后被掐断连接。'
        + '请到设置页确认问答模型可用（「诊断」页可看到模型列表与可问答模型数量），或换用其他模型再问一次；'
        + '自建服务请查看后端日志中该请求的大模型报错。'
    };
  }

  // 10) 流被中断（后端用 finish_reason=incomplete 标记，表示模型未给出结束原因就断了）
  if (events.finishReason === 'incomplete') {
    return {
      ...done,
      level: 'stream',
      verdict: '流在模型给出结束原因之前中断（finish_reason=incomplete）。',
      action: '多为模型调用超时或连接被打断。重试一次；若稳定复现，检查后端到模型服务的网络与超时设置。'
    };
  }

  // 11) 正常结束但没有任何回答内容
  if (events.types?.complete > 0 || events.sawComplete) {
    return {
      ...done,
      level: 'empty',
      verdict: '后端正常结束了本轮，但没有产生任何回答内容。',
      action:
        '两类原因：①检索没命中（知识库为空或文档还没解析完成，可换关键词、并确认文档状态为「已完成」）；'
        + '②后端缺少「知识问答」类型的模型（在「诊断」页看模型列表里是否有 KnowledgeQA 类型）。'
    };
  }

  // 12) 其余：流没正常结束，也没命中上面任何一条。
  //     必须先看 hasAnswerEvent：答案吐到一半断开时 types.answer > 0，第 9 条会被
  //     `!hasAnswerEvent` 挡掉并落到这里；此时若还说"没有任何 answer 事件"，
  //     就与气泡里已经显示出来的半截答案自相矛盾 —— 那正是本次要消灭的问题。
  return {
    ...done,
    level: 'stream',
    verdict: hasAnswerEvent
      ? `已收到 ${types.answer} 段回答内容，但流在完成标记之前中断了，本条回答可能不完整或被截断。`
      : eventTotal > 0
        ? `收到 ${eventTotal} 个事件（${describeTypes(types)}），但没有任何 answer 事件，流也未正常结束。`
        : (frames > 0
          ? `收到了 ${frames} 帧但都不是回答内容，流也未正常结束。`
          : '未收到回答，且没有可用的诊断信息。'),
    // 「去诊断页自检」对"答案被截断"没有意义，这里必须给能直接执行的动作
    action: hasAnswerEvent
      ? '回答被截断：可点重试重新生成；若反复中断，注意模型额度/限流（如 429）或后端生成超时。'
      : '到「诊断」页跑一次「问答链路自检」，它会直接给出结论。'
  };
}

// 把底层异常翻译成用户看得懂、且能据此行动的一句话。
//
// 为什么需要：Chat 之前直接展示 err.message，而 Android WebView 在 fetch 失败时抛的是
// "Failed to fetch" / "network error" 这类英文短语 —— 用户既看不懂，也会被误导去查网络，
// 而真实原因常常是服务端在「生成答案」阶段把连接掐断了（模型 429 / 超时）。
// 这里只做归类与措辞，不改变任何判定顺序（判定仍由 diagnoseNoAnswer 负责）。
//
// @returns {{ kind: 'aborted'|'network'|'rate-limit'|'server'|'rejected'|'unknown', message: string }}
export function describeStreamError(err) {
  if (!err) {
    return { kind: 'unknown', message: '对话失败：未取得异常信息。' };
  }
  const name = typeof err.name === 'string' ? err.name : '';
  const raw = typeof err.message === 'string' ? err.message : String(err);

  // 用户主动点「停止」才算 aborted，不该弹红条。
  // 判定必须**只认用户主动中止**：WebView 的真实断连串是 net::ERR_CONNECTION_ABORTED，
  // 宽泛的 /aborted/i 会把「网络断了」说成「用户自己点了停止」，比不说还糟。
  if (name === 'AbortError' || /operation was aborted|the user aborted|user abort/i.test(raw)) {
    return { kind: 'aborted', message: '已停止生成。' };
  }

  // 服务端返回的状态码（chatStream 在 !res.ok 时抛 new Error('HTTP xxx' 或后端 message)）
  const httpMatch = raw.match(/HTTP\s+(\d{3})/i);
  if (httpMatch) {
    const code = Number(httpMatch[1]);
    if (code === 429) {
      return {
        kind: 'rate-limit',
        message: '服务端限流或模型额度已用尽（HTTP 429）。可稍后重试，或到设置页换用其他问答模型。'
      };
    }
    if (code >= 500) {
      return { kind: 'server', message: `服务端出错（HTTP ${code}）。可稍后重试，并查看下方诊断信息。` };
    }
    if (code >= 400) {
      return { kind: 'rejected', message: `请求被拒绝（HTTP ${code}）。诊断信息里有服务端给出的原因。` };
    }
  }

  // fetch 底层失败：既可能是真的断网，也可能是服务端在流式输出中途直接断开连接
  // （Chrome/WebView 对这两种情况抛的都是同一个 TypeError，客户端无法区分）。
  // 只按**具体措辞**归类，不认所有 TypeError —— 否则 "Cannot read properties…"
  // 这类代码 bug 也会被说成网络问题，反而更难排查。
  const looksLikeNetwork = /failed to fetch|network\s?error|load failed|err_connection|network connection was lost|connection (?:closed|reset|aborted)/i.test(raw);
  if (name === 'NetworkError' || looksLikeNetwork) {
    return {
      kind: 'network',
      message:
        '连接中断：可能是手机网络切换，也可能是服务端在生成答案时异常终止了本次流'
        + '（常见于模型额度不足/被限流 429、生成超时）。请重试一次，仍失败请看下方诊断。'
    };
  }

  // 其余为服务端/解析给出的具体中文信息，原样展示即可
  return { kind: 'unknown', message: raw || '对话失败：未知异常。' };
}

// 组装可复制给他人排查的诊断串（不包含 API Key / 不包含知识库内容）
export function formatDiagnosisReport({ verdict, detail = [], requestId, query, kbCount, modelCount, appVersion }) {
  return [
    '=== WeKnora Mobile 问答诊断 ===',
    `时间：${new Date().toISOString()}`,
    `App 版本：${appVersion || '未知'}`,
    `提问长度：${query ? query.length : 0} 字`,
    `已选知识库：${kbCount ?? '?'} 个 · 可选问答模型：${modelCount ?? '?'} 个`,
    `结论：${verdict}`,
    '--- 证据 ---',
    ...detail,
    requestId ? `请求 ID：${requestId}` : null
  ].filter(Boolean).join('\n');
}
