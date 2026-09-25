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
//   events 客户端侧统计（各 response_type 计数、finish_reason、error 内容、是否收到 complete）
// 输出：
//   { level: 'auth'|'network'|'stream'|'backend'|'empty'|'none', verdict, detail[], action }

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
    sampleRaw ? `响应样本：${sampleRaw.slice(0, 200)}` : null,
    requestId ? `请求 ID：${requestId}` : null
  ].filter(Boolean);

  const done = { detail, requestId };

  // 1) 请求根本没发出去（离线 / 地址不可达）
  if (!status) {
    return {
      ...done,
      level: 'network',
      verdict: '请求没能建立连接，或中途被中断。',
      action: '检查手机网络，以及设置里的服务器地址是否可达（可在「诊断」页先跑一键测试）。'
    };
  }

  // 2) 鉴权失败：Key 无效、或该 Key 缺少问答能力（后端对 /knowledge-chat 要求 chat 权限）
  if (status === 401 || status === 403) {
    return {
      ...done,
      level: 'auth',
      verdict: `鉴权失败（HTTP ${status}）。API Key 无效，或该 Key 没有问答权限。`,
      action: '到设置页更新 API Key；若 Key 是「知识库受限」类型，需要换成有问答权限的 Key。'
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

  // 7) 流开了但一个字节都没来
  if (frames === 0 && bytes === 0) {
    return {
      ...done,
      level: 'stream',
      verdict: '流已建立，但服务端一个字节都没返回。',
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

  // 9) 流被中断（后端用 finish_reason=incomplete 标记，表示模型未给出结束原因就断了）
  if (events.finishReason === 'incomplete') {
    return {
      ...done,
      level: 'stream',
      verdict: '流在模型给出结束原因之前中断（finish_reason=incomplete）。',
      action: '多为模型调用超时或连接被打断。重试一次；若稳定复现，检查后端到模型服务的网络与超时设置。'
    };
  }

  // 10) 正常结束但没有任何回答内容
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

  // 11) 其余：收到了非回答类型的事件就断了
  return {
    ...done,
    level: 'stream',
    verdict: frames > 0
      ? `收到了 ${frames} 帧但都不是回答内容，流也未正常结束。`
      : '未收到回答，且没有可用的诊断信息。',
    action: '到「诊断」页跑一次「问答链路自检」，它会直接给出结论。'
  };
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
