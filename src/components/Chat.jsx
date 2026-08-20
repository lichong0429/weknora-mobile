import { useState, useEffect, useRef } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Session, Message, KB, Agent, Model } from '../api/endpoints.js';
import { chatStream } from '../api/client.js';
import {
  Loader2, AlertCircle, Send, Square, Bot, Settings2, BookOpen, Sparkles, User, Cpu
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  const kbs = kbRes?.data || [];
  const agents = agentRes?.data || [];
  const models = (modelRes?.data || []).filter((m) => m.type === 'KnowledgeQA');
  const session = sessionRes?.data;

  useEffect(() => {
    if (messagesRes?.data) {
      // API returns newest first; reverse to chronological order
      const reversed = [...messagesRes.data].reverse();
      setMessages(reversed);
    }
  }, [messagesRes]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  // 从路由 state 预选 KB / agent（从知识库「开始对话」或智能体「测试对话」跳转而来）
  useEffect(() => {
    const stateKbId = location.state?.knowledge_base_id;
    const stateAgentId = location.state?.agent_id;
    if (stateKbId && selectedKBs.length === 0) {
      setSelectedKBs([stateKbId]);
    }
    if (stateAgentId && !selectedAgentId) {
      setSelectedAgentId(stateAgentId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

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

    try {
      for await (const ev of chatStream(id, payload, { type: selectedAgentId ? 'agent' : 'knowledge', signal: controller.signal })) {
        const json = ev.json;
        if (!json) continue;
        // 兼容后端可能用 response_type 或 type 作为事件字段名
        const response_type = json.response_type || json.type;
        const { content, knowledge_references, done, id: msgId } = json;

        if (msgId) setLastMessageId(msgId);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = { ...last };
          if (response_type === 'answer' && typeof content === 'string') {
            next.content += content;
          }
          if (response_type === 'references' || response_type === 'reference' && Array.isArray(knowledge_references)) {
            next.knowledge_references = knowledge_references;
          }
          if (response_type === 'error') {
            next.content += `\n[错误] ${content}`;
          }
          return [...prev.slice(0, -1), next];
        });

        if (done) break;
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        setStreamError(err.message || '对话失败');
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          return [...prev.slice(0, -1), { ...last, content: last.content || '[请求失败]' }];
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
      refreshMessages();
    }
  };

  const handleStop = async () => {
    abortRef.current?.abort();
    if (lastMessageId) {
      try { await Session.stop(id, lastMessageId); } catch {}
    }
    setStreaming(false);
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
                <div className={msg.role === 'user' ? '' : 'md-body'}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
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

export default Chat;
