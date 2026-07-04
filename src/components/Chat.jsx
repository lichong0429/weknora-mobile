import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { useAsync } from '../hooks/useApi.js';
import { Session, Message, KB, Agent } from '../api/endpoints.js';
import { chatStream } from '../api/client.js';
import {
  Loader2, AlertCircle, Send, Square, Bot, Settings2, BookOpen, Sparkles, User
} from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function Chat() {
  const { id } = useParams();
  const { data: sessionRes, loading: sessionLoading, error: sessionError, run: refreshSession } = useAsync(() => Session.detail(id), [id]);
  const { data: messagesRes, loading: messagesLoading, error: messagesError, run: refreshMessages } = useAsync(() => Message.load(id, { limit: 50 }), [id]);
  const { data: kbRes } = useAsync(() => KB.list(), []);
  const { data: agentRes } = useAsync(() => Agent.list(), []);

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamError, setStreamError] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [selectedKBs, setSelectedKBs] = useState([]);
  const [lastMessageId, setLastMessageId] = useState(null);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);

  const kbs = kbRes?.data || [];
  const agents = agentRes?.data || [];
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

  const toggleKB = (kbId) => {
    setSelectedKBs((prev) =>
      prev.includes(kbId) ? prev.filter((x) => x !== kbId) : [...prev, kbId]
    );
  };

  const handleSend = async () => {
    if (!input.trim() || streaming) return;
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
        const { response_type, content, knowledge_references, done, id: msgId } = json;

        if (msgId) setLastMessageId(msgId);

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (!last || last.role !== 'assistant') return prev;
          const next = { ...last };
          if (response_type === 'answer' && typeof content === 'string') {
            next.content += content;
          }
          if (response_type === 'references' && Array.isArray(knowledge_references)) {
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
      <div className="safe-top sticky top-0 z-10 border-b bg-white px-4 py-3">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold text-gray-900">{session?.title || '新会话'}</h2>
            <p className="truncate text-xs text-gray-500">
              {selectedAgentId ? agents.find((a) => a.id === selectedAgentId)?.name : '知识库问答'}
              {selectedKBs.length > 0 && ` · ${selectedKBs.length} 个知识库`}
            </p>
          </div>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className={clsx('rounded-full p-2', showConfig ? 'bg-blue-100 text-blue-600' : 'text-gray-500 hover:bg-gray-100')}
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>

        {showConfig && (
          <div className="mt-3 space-y-3 rounded-xl bg-gray-50 p-3">
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
                  'max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm',
                  msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-white text-gray-800'
                )}
              >
                <div className="mb-1 flex items-center gap-1 text-xs opacity-70">
                  {msg.role === 'user' ? <User className="h-3 w-3" /> : <Sparkles className="h-3 w-3" />}
                  {msg.role === 'user' ? '我' : 'AI'}
                </div>
                <div className="prose prose-sm max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.content || (msg.isStream ? '思考中…' : '')}
                  </ReactMarkdown>
                </div>
                {msg.knowledge_references?.length > 0 && (
                  <div className="mt-3 border-t border-gray-200 pt-2">
                    <p className="mb-1 text-xs font-medium text-gray-500">引用</p>
                    <div className="space-y-1">
                      {msg.knowledge_references.slice(0, 3).map((ref, i) => (
                        <div key={ref.id || i} className="rounded-lg bg-gray-50 p-2 text-xs text-gray-600">
                          <span className="font-medium text-blue-600">{ref.knowledge_title}</span>
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
      <div className="safe-bottom border-t bg-white px-4 py-3">
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
            className="max-h-32 flex-1 resize-none rounded-2xl border border-gray-300 px-3 py-2.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {streaming ? (
            <button
              onClick={handleStop}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600"
            >
              <Square className="h-4 w-4 fill-current" />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white disabled:opacity-50"
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
