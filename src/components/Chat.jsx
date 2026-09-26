import { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Session, Message, KB, Agent, Model, Chunk } from '../api/endpoints.js';
import { chatStream } from '../api/client.js';
import { pushBackHandler } from '../backHandler.js';
import {
  Loader2, AlertCircle, Send, Square, Bot, Settings2, BookOpen, Sparkles, User, Cpu,
  Copy, Check, Stethoscope, X, FileText, ExternalLink, ChevronDown, ChevronUp, Quote, Globe
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { MarkdownImage } from './MarkdownImage.jsx';
import { diagnoseNoAnswer, formatDiagnosisReport } from '../utils/chatDiagnosis.js';
import { isTerminalStreamEvent } from '../utils/chatStreamProtocol.js';
import {
  extractCitations, extractInlineThinking, resolveCitation, stripIncompleteCitationTag,
  truncateMiddle, domainOf, CITE_KB_PREFIX, CITE_WEB_PREFIX, WIKI_PREFIX
} from '../utils/citationMarkers.js';
import { APP_VERSION } from '../utils/appVersion.js';

function Chat() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
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
  // 引用详情：点开某条引用时展示原文与来源，以及每条消息的"展开全部引用"状态
  const [activeRef, setActiveRef] = useState(null);
  const [expandedRefs, setExpandedRefs] = useState({});
  const [refCopied, setRefCopied] = useState(false);
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

  // 引用详情弹层：注册返回栈，让系统返回键/手势先关弹层，而不是退出会话页
  useEffect(() => {
    if (!activeRef) return undefined;
    return pushBackHandler(() => {
      setActiveRef(null);
      return true;
    });
  }, [activeRef]);

  const openRef = (ref) => {
    setRefCopied(false);
    setActiveRef(ref);
  };

  // 点正文里的引用角标：把标记对到后端返回的引用对象上，复用同一个详情弹层。
  // references 里 id 就是 chunk id，用它匹配；放在全部消息里找，避免流式期间
  // 引用还挂在其它消息对象上的情况。不用 flatMap，兼容旧 WebView。
  const openCitationMarker = (marker, num) => {
    if (!marker) return;
    const allRefs = messages.reduce(
      (acc, m) => acc.concat(m.knowledge_references || []),
      []
    );
    const resolved = resolveCitation(marker, allRefs) || {};
    openRef({ ...resolved, _citeNumber: num });
  };

  // [[wiki 页面]] 链接：App 内 wiki 页挂在 /kb/{id} 的 wiki 标签下，
  // 这里带着 slug 跳过去，由 KBDetail 切到 wiki 标签并让 WikiView 打开该页。
  // 没有可用知识库时不提供点击（渲染成普通文字），避免出现点了没反应的死链。
  const wikiKbId = (selectedKBs && selectedKBs[0]) || (kbs.length === 1 ? kbs[0].id : '');
  const openWikiPage = (slug) => {
    if (!slug || !wikiKbId) return;
    navigate(`/kb/${wikiKbId}`, { state: { wikiSlug: slug } });
  };

  // 引用详情里可能拿不到正文（后端只回传引用列表里靠前的片段，
  // 正文标注的引用常常超出该列表）—— 这时按 chunk id 现取，与网页端行为一致。
  const [refChunk, setRefChunk] = useState({ loading: false, error: null, data: null });
  useEffect(() => {
    if (!activeRef || activeRef._web || activeRef.content || !activeRef.id) {
      setRefChunk({ loading: false, error: null, data: null });
      return undefined;
    }
    let cancelled = false;
    setRefChunk({ loading: true, error: null, data: null });
    Chunk.byId(activeRef.id)
      .then((res) => {
        if (cancelled) return;
        setRefChunk({ loading: false, error: null, data: res?.data || res || null });
      })
      .catch((err) => {
        if (cancelled) return;
        setRefChunk({ loading: false, error: err?.message || '加载失败', data: null });
      });
    return () => { cancelled = true; };
  }, [activeRef]);
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
        const { content, knowledge_references } = json;
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

        // 终止条件：只有 complete（或 error+done）才代表流结束。
        // 千万不能用 `if (done) break;` —— 后端第一个 agent_query 事件就带 done=true，
        // 那样会在第一帧退出，一个 answer 都读不到（这正是"问答没有回答"的根因）。
        if (isTerminalStreamEvent(json)) break;
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
          {messages.map((msg, idx) => {
            const isAssistant = msg.role === 'assistant';
            // 助手正文里的 <think> 抽出来给「思考过程」块；引用标记由 AssistantMarkdown 处理
            const thinkDigest = isAssistant ? extractInlineThinking(msg.content || '') : null;
            const bodyContent = thinkDigest ? thinkDigest.text : (msg.content || '');
            const reasoningText = isAssistant ? (msg.reasoning || thinkDigest.thinking) : '';
            return (
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
                {isAssistant && reasoningText && (
                  <ThinkingBlock text={reasoningText} />
                )}
                <div className={msg.role === 'user' ? '' : 'md-body'}>
                  {isAssistant ? (
                    <AssistantMarkdown
                      content={bodyContent || (msg.isStream ? '思考中…' : '')}
                      references={msg.knowledge_references}
                      onOpenCitation={openCitationMarker}
                      onOpenWiki={wikiKbId ? openWikiPage : undefined}
                    />
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw]}
                      components={{ img: MarkdownImage }}
                    >
                      {msg.content || ''}
                    </ReactMarkdown>
                  )}
                </div>
                {msg.knowledge_references?.length > 0 && (
                  <div className="mt-3 border-t border-line pt-2">
                    <div className="mb-1 flex items-center justify-between">
                      <p className="flex items-center gap-1 text-xs font-medium text-ink-muted">
                        <Quote className="h-3 w-3" /> 引用 {msg.knowledge_references.length} 条
                      </p>
                      {msg.knowledge_references.length > 3 && (
                        <button
                          type="button"
                          onClick={() => setExpandedRefs((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                          className="flex items-center gap-0.5 text-[11px] font-medium text-brand-600"
                        >
                          {expandedRefs[msg.id] ? '收起' : `展开全部`}
                          {expandedRefs[msg.id] ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      )}
                    </div>
                    <div className="space-y-1">
                      {(expandedRefs[msg.id] ? msg.knowledge_references : msg.knowledge_references.slice(0, 3)).map((ref, i) => (
                        // 整块可点：点开看引用原文与来源文档（此前是静态文本，点不动）
                        <button
                          type="button"
                          key={ref.id || i}
                          onClick={() => openRef(ref)}
                          className="block w-full rounded-lg bg-surface-soft p-2 text-left text-xs text-ink-secondary active:scale-[0.99]"
                        >
                          <span className="flex items-center gap-1 font-medium text-brand-600">
                            <FileText className="h-3 w-3 shrink-0" />
                            <span className="truncate">{ref.knowledge_title || ref.knowledge_filename || '引用片段'}</span>
                          </span>
                          <p className="mt-0.5 line-clamp-2">{ref.content}</p>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            );
          })}
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

      {/* 引用详情弹层：此前引用只是静态文本，点不动；现在可看原文、来源与位置 */}
      {activeRef && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setActiveRef(null)}
        >
          <div
            className="flex max-h-[82vh] w-full flex-col rounded-t-2xl bg-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-2 border-b border-line p-4 pb-3">
              {activeRef._web
                ? <Globe className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
                : <Quote className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900">
                  {activeRef._citeNumber ? `引用 ${activeRef._citeNumber} · ` : ''}
                  {activeRef.knowledge_title || activeRef.knowledge_filename || '引用片段'}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-gray-500">
                  {activeRef._web
                    ? activeRef.url
                    : (activeRef.knowledge_filename || '来源文档')}
                  {!activeRef._web && activeRef.chunk_index !== undefined && ` · 第 ${activeRef.chunk_index} 段`}
                  {!activeRef._web && typeof activeRef.score === 'number' && ` · 相关度 ${activeRef.score.toFixed(4)}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveRef(null)}
                className="shrink-0 rounded-full p-1 text-gray-400 hover:bg-gray-100"
                aria-label="关闭"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {(activeRef.start_at !== undefined && activeRef.end_at !== undefined) && !activeRef._web && (
                <p className="mb-2 text-[11px] text-gray-400">
                  原文位置：第 {activeRef.start_at}–{activeRef.end_at} 字符
                </p>
              )}

              {activeRef._web ? (
                <p className="text-xs leading-relaxed text-gray-600">
                  这是联网搜索命中的网页，点下方按钮会在浏览器中打开。
                </p>
              ) : refChunk.loading ? (
                <p className="flex items-center gap-1.5 text-xs text-gray-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取引用原文…
                </p>
              ) : refChunk.error ? (
                <div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800">
                  取引用原文失败：{refChunk.error}
                  <br />
                  可点下方「查看来源文档」到文档里查看完整内容。
                </div>
              ) : (activeRef.content || refChunk.data?.content) ? (
                <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-800">
                  {activeRef.content || refChunk.data?.content}
                </p>
              ) : (
                <p className="text-xs leading-relaxed text-gray-500">
                  这条引用没有可显示的正文（后端只回传引用列表中靠前的片段，正文里标注的引用可能超出该列表）。
                  {activeRef.knowledge_filename ? ` 来源文档：${activeRef.knowledge_filename}。` : ''}
                  可点下方「查看来源文档」到文档里查看完整内容。
                </p>
              )}
              {/* 元数据里的 content 常是父块全文，比命中片段更完整，作为补充展示 */}
              {activeRef.metadata?.content && activeRef.metadata.content !== activeRef.content && (
                <details className="mt-3 rounded-xl bg-surface-soft p-3">
                  <summary className="cursor-pointer text-xs font-medium text-gray-700">
                    查看所在段落全文
                  </summary>
                  <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-gray-600">
                    {activeRef.metadata.content}
                  </p>
                </details>
              )}
            </div>

            <div className="flex gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {activeRef._web ? (
                // 普通 <a> 导航会被原生层的 shouldOverrideUrlLoading 拦下并交给系统浏览器
                <a
                  href={activeRef.url}
                  className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-sky-600 py-2.5 text-xs font-medium text-white no-underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> 打开网页
                </a>
              ) : (
                <>
                  {activeRef.knowledge_id && (
                    <button
                      type="button"
                      onClick={() => {
                        const kid = activeRef.knowledge_id;
                        setActiveRef(null);
                        navigate(`/knowledge/${kid}`);
                      }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-brand-600 py-2.5 text-xs font-medium text-white"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> 查看来源文档
                    </button>
                  )}
                  {(activeRef.content || refChunk.data?.content) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const text = activeRef.content || refChunk.data?.content || '';
                        try {
                          await navigator.clipboard.writeText(text);
                          setRefCopied(true);
                          setTimeout(() => setRefCopied(false), 2000);
                        } catch {
                          window.prompt('复制引用内容：', text);
                        }
                      }}
                      className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-surface-subtle py-2.5 text-xs font-medium text-gray-700"
                    >
                      {refCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                      {refCopied ? '已复制' : '复制引用'}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 助手正文渲染：把 <kb …/> 文档引用与 <web …/> 联网引用变成可点胶囊，并把 <think> 抽成思考块。
// 独立成组件是为了能用 useMemo（messages.map 里不能调 hook）。
function AssistantMarkdown({ content, references, onOpenCitation, onOpenWiki }) {
  const { text, markers } = useMemo(
    () => extractCitations(stripIncompleteCitationTag(content || ''), references),
    [content, references]
  );
  const byNumber = useMemo(() => new Map(markers.map((m) => [m.number, m])), [markers]);
  const components = useMemo(() => ({
    img: MarkdownImage,
    a: ({ href, children, ...rest }) => {
      // [[wiki 页面]] 链接：跳到该知识库的 wiki 页
      if (typeof href === 'string' && href.startsWith(WIKI_PREFIX)) {
        let slug = href.slice(WIKI_PREFIX.length);
        try { slug = decodeURIComponent(slug); } catch {}
        const label = typeof children === 'string' ? children : slug;
        if (!onOpenWiki) {
          return <span className="text-brand-600">{label}</span>;
        }
        return (
          <button
            type="button"
            onClick={() => onOpenWiki(slug)}
            title={`打开 wiki 页面：${slug}`}
            className="mx-0.5 inline-flex items-center gap-0.5 rounded-md bg-violet-50 px-1 py-0.5 align-middle text-[11px] font-medium text-violet-700 active:scale-95"
          >
            <BookOpen className="h-3 w-3 shrink-0" />
            {label}
          </button>
        );
      }
      if (typeof href === 'string' && (href.startsWith(CITE_KB_PREFIX) || href.startsWith(CITE_WEB_PREFIX))) {
        const isWeb = href.startsWith(CITE_WEB_PREFIX);
        const num = Number(href.slice((isWeb ? CITE_WEB_PREFIX : CITE_KB_PREFIX).length));
        const marker = byNumber.get(num);
        if (isWeb) {
          // 联网引用：显示域名，点击交给系统浏览器（与网页端"新标签打开"等价）
          const url = marker?.url || '';
          return (
            <a
              href={url}
              title={marker?.title || url}
              className="mx-0.5 inline-flex max-w-[10rem] items-center gap-0.5 rounded-md bg-sky-50 px-1 py-0.5 align-middle text-[10px] font-medium text-sky-700 no-underline"
            >
              <Globe className="h-2.5 w-2.5 shrink-0" />
              <span className="truncate">{domainOf(url)}</span>
            </a>
          );
        }
        // 文档引用：显示文档名（中间省略），点击打开引用详情
        return (
          <button
            type="button"
            onClick={() => onOpenCitation?.(marker, num)}
            title={marker?.doc ? `引用：${marker.doc}` : `引用 ${num}`}
            className="mx-0.5 inline-flex max-w-[10rem] items-center gap-0.5 rounded-md bg-brand-50 px-1 py-0.5 align-middle text-[10px] font-medium text-brand-600 active:scale-95"
          >
            <BookOpen className="h-2.5 w-2.5 shrink-0" />
            <span className="truncate">{truncateMiddle(marker?.doc || '引用')}</span>
          </button>
        );
      }
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer">{children}</a>
      );
    }
  }), [byNumber, onOpenCitation, onOpenWiki]);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      // 放行自有 cite:/wiki: 协议，其余仍走默认白名单（不要整体关闭，避免给模型输出开洞）
      urlTransform={(url) => (
        url.startsWith(CITE_KB_PREFIX) || url.startsWith(CITE_WEB_PREFIX) || url.startsWith(WIKI_PREFIX)
          ? url
          : defaultUrlTransform(url)
      )}
      components={components}
    >
      {text}
    </ReactMarkdown>
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
