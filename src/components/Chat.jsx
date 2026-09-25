import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Session, Message, KB, Agent, Model } from '../api/endpoints.js';
import { chatStream } from '../api/client.js';
import {
  Loader2, AlertCircle, Send, Square, Bot, Settings2, BookOpen, Sparkles, User, Cpu,
  Copy, Check, Stethoscope
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { MarkdownImage } from './MarkdownImage.jsx';
import { diagnoseNoAnswer, formatDiagnosisReport } from '../utils/chatDiagnosis.js';
import { APP_VERSION } from '../utils/appVersion.js';

function Chat() {
  const { id } = useParams();
  const location = useLocation();
  const { data: sessionRes, loading: sessionLoading, error: sessionError, run: refreshSession } = useAsync(() => Session.detail(id), [id]);
  const { data: messagesRes, loading: messagesLoading, error: messagesError, run: refreshMessages } = useAsync(() => Message.load(id, { limit: 50 }), [id]);
  const { data: kbRes } = useAsync(() => KB.list(), []);
  const { data: agentRes } = useAsync(() => Agent.list(), []);
  const { data: modelRes } = useAsync(() => Model.list(), []);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedKBs, setSelectedKBs] = useState([]);
  const [selectedModelId, setSelectedModelId] = useState('');
  const [lastMessageId, setLastMessageId] = useState(null);
  // 最近一次问答失败的诊断报告（可一键复制），以及复制反馈
  const [noAnswerReport, setNoAnswerReport] = useState(null);
  const [lastDiagnosis, setLastDiagnosis] = useState(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  // 流式进行中：阻止服务端历史消息回写覆盖正在显示的回答
  const streamingRef = useRef(false);

  const kbs = kbRes?.data || [];
  const agents = agentRes?.data || [];
  const models = (modelRes?.data || []).filter((m) => m.type === 'KnowledgeQA');
  const session = sessionRes?.data;

  useEffect(() => {
    if (!messagesRes?.data) return;
    // 流式期间不回写：服务端历史里还没有本轮答案，覆盖会把正在显示的回答清空
    if (streamingRef.current) return;

    // API returns newest first; reverse to chronological order
    const reversed = [...messagesRes.data].reverse();
    const server = reversed.map((m) => ({
      ...m,
      reasoning: m.reasoning_content || m.reasoning || m.thinking || m.thought || m.reasoning
    }));

    setMessages((prev) => {
      const lastLocal = prev[prev.length - 1];
      const lastServer = server[server.length - 1];
      const localHasAnswer =
        lastLocal?.role === 'assistant' && (lastLocal.content || lastLocal.reasoning);

      // 场景 A：服务端已有本轮 assistant 消息但内容为空（尚未落库完成）→ 保留本地内容
      if (localHasAnswer && lastServer?.role === 'assistant' && !lastServer.content) {
        return [
          ...server.slice(0, -1),
          {
            ...lastServer,
            content: lastLocal.content || '',
            reasoning: lastLocal.reasoning || lastServer.reasoning,
            knowledge_references:
              lastLocal.knowledge_references?.length
                ? lastLocal.knowledge_references
                : lastServer.knowledge_references
          }
        ];
      }
      // 场景 B：服务端还没有本轮 assistant 消息 → 把本地答案补在末尾
      if (localHasAnswer && lastServer?.role !== 'assistant' && lastLocal.content) {
        return [...server, lastLocal];
      }
      return server;
    });
  }, [messagesRes]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // 从路由 state 预选 KB / agent（从知识库「开始对话」或智能体「测试对话」跳转而来）
  useEffect(() => {
    const stateKbId = location.state?.knowledge_base_id;
    const stateAgentId = location.state?.agent_id;
    if (stateKbId) {
      setSelectedKBs((prev) => (prev.length ? prev : [stateKbId]));
    }
    if (stateAgentId) {
      setSelectedAgentId(stateAgentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // 未从知识库跳转、且服务端只有一个知识库时自动选中，
  // 避免用户进会话后直接提问却因为没有知识库而拿不到回答
  useEffect(() => {
    if (location.state?.knowledge_base_id || location.state?.agent_id) return;
    if (kbs.length === 1) {
      setSelectedKBs((prev) => (prev.length ? prev : [kbs[0].id]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kbs.length]);

  const toggleKB = (kbId) => {
    setSelectedKBs((prev) =>
      prev.includes(kbId) ? prev.filter((x) => x !== kbId) : [...prev, kbId]
    );
  };

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
    if (selectedKBs.length === 0 && !selectedAgentId) {
      setStreamError('请先点右上角设置图标，选择至少一个知识库或智能体，再提问。');
      return;
    }
    const query = input.trim();
    setInput('');
    setStreamError(null);
    setStreaming(true);
    streamingRef.current = true;

    const userMessage = { id: `user-${Date.now()}`, role: 'user', content: query, knowledge_references: [] };
    const assistantMessage = { id: `assistant-${Date.now()}`, role: 'assistant', content: '', knowledge_references: [], isStream: true };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);

    const payload = {
      query,
      knowledge_base_ids: selectedKBs.length ? selectedKBs : undefined
    };
    if (selectedModelId) {
      // WeKnora 知识问答接口用 summary_model_id 覆盖默认摘要模型
      payload.summary_model_id = selectedModelId;
    }
    if (selectedAgentId) {
      payload.agent_id = selectedAgentId;
      payload.agent_enabled = true;
    }

    const controller = new AbortController();
    abortRef.current = controller;

    // 超时检测：如果 15 秒内没收到任何内容，提示用户
    const timeoutId = setTimeout(() => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        if (last.content) return prev; // 已收到内容，不提示
        return [...prev.slice(0, -1), { ...last, content: '⏳ 等待响应中…服务器可能需要较长时间，请稍候。' }];
      });
    }, 15000);

    // 本次流的证据采集：只统计「收到了什么」，不涉及内容隐私。
    // 声明在 try 之外，异常分支同样需要用这些证据给出结论。
    const streamDiag = { status: 0, contentType: '', frames: 0, bytes: 0, parseErrors: 0, sampleRaw: '', requestId: '' };
    const streamEvents = { types: {}, finishReason: '', errorMessage: '', sawComplete: false };

    try {
      let receivedAny = false;
      for await (const ev of chatStream(id, payload, {
        type: selectedAgentId ? 'agent' : 'knowledge',
        signal: controller.signal,
        onMeta: (d) => Object.assign(streamDiag, d)
      })) {
        const json = ev.json;
        if (!json) continue;
        // 兼容后端可能用 response_type 或 type 作为事件字段名
        const response_type = json.response_type || json.type;
        const { content, knowledge_references, done } = json;
        // 注意：StreamResponse.id 是**事件** id，助手消息 id 在 assistant_message_id。
        // 之前直接用 id 会把这个值当成 message_id 发给「停止生成」接口，导致停止无效。
        if (json.assistant_message_id || json.id) {
          setLastMessageId(json.assistant_message_id || json.id);
        }

        if (response_type) {
          streamEvents.types[response_type] = (streamEvents.types[response_type] || 0) + 1;
        }
        if (json.finish_reason) streamEvents.finishReason = json.finish_reason;
        if (response_type === 'complete') streamEvents.sawComplete = true;
        if (response_type === 'error') streamEvents.errorMessage = content || streamEvents.errorMessage;

        // 思考过程：兼容 DeepSeek 系 reasoning_content、OpenAI 系 reasoning，以及后端自定义 thinking/thought 字段
        const reasoningChunk =
          json.reasoning_content || json.reasoning || json.thinking || json.thought;

        if ((typeof content === 'string' && content) || (response_type === 'answer')) receivedAny = true;

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = { ...last };
          // 思考过程单独累加，不混入正文
          if (response_type === 'reasoning' || response_type === 'thinking' || response_type === 'reasoning_content') {
            if (typeof content === 'string') {
              next.reasoning = (next.reasoning || '') + content;
            }
          } else if (typeof reasoningChunk === 'string' && reasoningChunk) {
            next.reasoning = (next.reasoning || '') + reasoningChunk;
          }
          if (response_type === 'answer' && typeof content === 'string') {
            next.content += content;
          }
          // 括号必须显式：原写法 `a === 'references' || a === 'reference' && Array.isArray(...)`
          // 因 && 优先级更高，references 分支会无条件覆盖引用（可能写入 undefined）
          if (
            (response_type === 'references' || response_type === 'reference')
            && Array.isArray(knowledge_references)
          ) {
            next.knowledge_references = knowledge_references;
          }
          if (response_type === 'error') {
            next.content += `\n[错误] ${content}`;
          }
          return [...prev.slice(0, -1), next];
        });

        if (done) break;
      }
      // 流结束但没收到任何内容 → 用采集到的证据给出**具体**结论，而不是三句无法互斥的猜测
      if (!receivedAny) {
        const verdict = diagnoseNoAnswer(streamDiag, streamEvents);
        setLastDiagnosis(verdict);
        setNoAnswerReport(formatDiagnosisReport({
          ...verdict,
          query,
          kbCount: selectedKBs.length,
          modelCount: models.length,
          appVersion: APP_VERSION
        }));
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          if (last.content) return prev; // 可能有 reasoning 但没 answer
          return [...prev.slice(0, -1), {
            ...last,
            content: `**未收到回答** —— ${verdict.verdict}\n\n${verdict.action}\n\n（下方诊断卡片可查看原始证据并复制）`,
            diagnosis: verdict
          }];
        });
      } else {
        setNoAnswerReport(null);
        setLastDiagnosis(null);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        const verdict = diagnoseNoAnswer(streamDiag, streamEvents);
        setLastDiagnosis(verdict);
        setNoAnswerReport(formatDiagnosisReport({
          ...verdict,
          detail: [...verdict.detail, `客户端异常：${err.message || err.name}`],
          query,
          kbCount: selectedKBs.length,
          modelCount: models.length,
          appVersion: APP_VERSION
        }));
        setStreamError(err.message || '对话失败');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, content: last.content || `[请求失败] ${err.message || '未知错误'}` }];
        });
      }
    } finally {
      clearTimeout(timeoutId);
      setStreaming(false);
      streamingRef.current = false;
      abortRef.current = null;
      // 延迟回写：给后端一点时间落库，避免拉回的历史里还没有本轮答案
      setTimeout(() => refreshMessages(), 800);
    }
  };

  const handleStop = async () => {
    abortRef.current?.abort();
    if (lastMessageId) {
      try { await Session.stop(id, lastMessageId); } catch {}
    }
    setStreaming(false);
    streamingRef.current = false;
  };

  const error = sessionError || messagesError;
  const loading = sessionLoading || messagesLoading;

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="safe-top sticky top-0 z-10 border-b border-line bg-white/90 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-ink">{session?.title || '新会话'}</h2>
            <p className="truncate text-xs text-ink-muted">
              {selectedAgentId ? agents.find((a) => a.id === selectedAgentId)?.name : '知识库问答'}
              {selectedKBs.length > 0 && ` · ${selectedKBs.length} 个知识库`}
            </p>
          </div>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={clsx('rounded-xl p-2', showConfig ? 'bg-brand-50 text-brand-600' : 'text-ink-muted hover:bg-surface-subtle')}
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>

        {showConfig && (
          <div className="mt-3 space-y-3 rounded-[14px] bg-surface-soft p-3">
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-ink-secondary">
                <Cpu className="h-3.5 w-3.5" /> 模型（可选）
              </label>
              <select
                value={selectedModelId}
                onChange={(e) => setSelectedModelId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">使用默认模型</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700">
                <Bot className="h-3.5 w-3.5" /> 智能体（可选）
              </label>
              <select
                value={selectedAgentId}
                onChange={(e) => setSelectedAgentId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-2 py-1.5 text-sm"
              >
                <option value="">不使用 Agent</option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-700">
                <BookOpen className="h-3.5 w-3.5" /> 关联知识库
              </label>
              <div className="max-h-32 overflow-y-auto rounded-lg border border-gray-200 bg-white p-2">
                {kbs.length === 0 && <p className="text-xs text-gray-400">暂无知识库</p>}
                {kbs.map((kb) => (
                  <label key={kb.id} className="flex items-center gap-2 py-1 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={selectedKBs.includes(kb.id)}
                      onChange={() => toggleKB(kb.id)}
                      className="h-4 w-4 text-blue-600"
                    />
                    <span className="truncate">{kb.name}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 no-scrollbar">
        {loading && (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
          </div>
        )}

        {error && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mr-1 inline h-4 w-4" /> {error}
          </div>
        )}

        {streamError && (
          <div className="mb-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mr-1 inline h-4 w-4" /> {streamError}
          </div>
        )}

        {selectedKBs.length === 0 && !selectedAgentId && kbs.length > 0 && (
          <div className="mb-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-700">
            <AlertCircle className="mr-1 inline h-4 w-4" />
            尚未选择知识库：请点右上角齿轮图标，勾选至少一个知识库后再提问。
          </div>
        )}

        <div className="space-y-4">
          {messages.map((msg, idx) => (
            <div
              key={msg.id || idx}
              className={clsx('flex', msg.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={clsx(
                  'max-w-[85%] rounded-[18px] px-4 py-3 text-sm shadow-card',
                  msg.role === 'user'
                    ? 'rounded-tr-[6px] bg-gradient-to-br from-brand-600 to-brand-400 text-white'
                    : 'rounded-tl-[6px] bg-white text-ink'
                )}
              >
                <div className={clsx('mb-1 flex items-center gap-1 text-xs', msg.role === 'user' ? 'opacity-80' : 'text-ink-muted')}>
                  {msg.role === 'user' ? <User className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                  {msg.role === 'user' ? '我' : 'AI'}
                </div>
                {msg.role === 'assistant' && msg.reasoning && (
                  <ThinkingBlock text={msg.reasoning} />
                )}
                <div className={msg.role === 'user' ? '' : 'md-body'}>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeRaw]}
                    components={{ img: MarkdownImage }}
                  >
                    {msg.content || (msg.isStream ? '思考中…' : '')}
                  </ReactMarkdown>
                </div>
                {msg.knowledge_references?.length > 0 && (
                  <div className="mt-3 border-t border-line pt-2">
                    <p className="mb-1 text-xs font-medium text-ink-muted">引用</p>
                    <div className="space-y-1">
                      {msg.knowledge_references.slice(0, 3).map((ref, i) => (
                        <div key={ref.id || i} className="rounded-lg bg-surface-soft p-2 text-xs text-ink-secondary">
                          <span className="font-medium text-brand-600">{ref.knowledge_title}</span>
                          <p className="line-clamp-2">{ref.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input */}
      <div className="safe-bottom border-t border-line bg-white px-4 py-3">
        {streamError && (
          <div className="mb-2 rounded-lg bg-red-50 px-2 py-1 text-xs text-red-700">{streamError}</div>
        )}

        {/* 诊断卡片：把"为什么没回答"的原始证据摊开，并可一键复制用于排查 */}
        {noAnswerReport && (
          <div className="mb-2 rounded-xl border border-amber-200 bg-amber-50 p-2.5">
            <div className="flex items-start gap-2">
              <Stethoscope className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-amber-800">本轮未收到回答 · 诊断</p>
                <p className="mt-1 text-[11px] leading-relaxed text-amber-800">
                  {lastDiagnosis?.verdict}
                </p>
                <div className="mt-1.5 space-y-0.5">
                  {(lastDiagnosis?.detail || []).slice(0, 4).map((d) => (
                    <p key={d} className="break-all text-[10px] text-amber-700">{d}</p>
                  ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(noAnswerReport);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      } catch {
                        // WebView 可能没有剪贴板权限：退化为长按选择文本
                        window.prompt('复制以下诊断信息：', noAnswerReport);
                      }
                    }}
                    className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-amber-800 shadow-sm"
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? '已复制' : '复制诊断信息'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setNoAnswerReport(null); setStreamError(null); }}
                    className="rounded-lg px-2 py-1 text-[11px] font-medium text-amber-700"
                  >
                    忽略
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            onFocus={(e) => {
              // 键盘弹出后确保输入框可见（WebView adjustResize 后再次对齐）
              setTimeout(() => e.target.scrollIntoView({ block: 'nearest' }), 250);
            }}
            rows={1}
            placeholder="输入问题…"
            className="max-h-32 flex-1 resize-none rounded-[14px] border border-line bg-surface-soft px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-red-50 text-red-600"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-gradient-to-br from-brand-600 to-brand-400 text-white shadow-brand-lg disabled:opacity-50"
            >
              <Send className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// 思考过程折叠块：默认折叠，点击展开
function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-2 overflow-hidden rounded-lg bg-surface-soft">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-[11px] font-medium text-ink-muted"
      >
        <span className={clsx('text-[10px] transition-transform', open && 'rotate-90')}>▶</span>
        思考过程
        <span className="ml-auto text-[10px] opacity-60">{open ? '收起' : '展开'}</span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto border-t border-line px-2.5 py-2 text-xs leading-relaxed text-ink-muted">
          {text}
        </div>
      )}
    </div>
  );
}

export default Chat;
