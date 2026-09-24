import { useState } from 'react';
import {
  ChevronDown, ChevronUp, X, RotateCcw, Loader2, AlertCircle,
  CheckCircle2, FileText, Link as LinkIcon, Ban, Trash2
} from 'lucide-react';
import { clsx } from 'clsx';
import { formatBytes, isInFlight, statusMeta, statusLabel } from '../utils/parseStatus.js';

function TaskRow({ task, parseStatus, onCancel, onRetry, onRemove }) {
  const inFlight = task.status === 'uploaded' && isInFlight(parseStatus);
  const parseDone = task.status === 'uploaded' && parseStatus && !isInFlight(parseStatus);

  return (
    <div className="rounded-xl bg-surface-soft p-2.5">
      <div className="flex items-start gap-2">
        <div className="mt-0.5 shrink-0 text-ink-muted">
          {task.name?.startsWith('http') ? <LinkIcon className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-gray-900">{task.name}</p>
          <p className="mt-0.5 text-[11px] text-gray-500">
            {formatBytes(task.size)}
            {task.status === 'uploading' && ` · 上传中 ${task.progress}%`}
            {task.status === 'queued' && ' · 排队中'}
            {task.status === 'uploaded' && ` · 已上传${parseStatus ? ` · ${statusLabel(parseStatus)}` : ''}`}
            {task.status === 'error' && ' · 上传失败'}
            {task.status === 'canceled' && ' · 已取消'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRemove(task.id)}
          className="shrink-0 rounded-lg p-1 text-gray-400 hover:bg-gray-100"
          title="从列表移除"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {task.status === 'uploading' && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full rounded-full bg-brand-600 transition-all duration-200"
            style={{ width: `${Math.max(2, task.progress)}%` }}
          />
        </div>
      )}

      {inFlight && (
        <div className="mt-2 flex items-center gap-1.5 text-[11px] text-blue-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          服务端解析中…
        </div>
      )}

      {parseDone && (
        <div className={clsx(
          'mt-2 flex items-center gap-1.5 text-[11px]',
          parseStatus === 'completed' ? 'text-emerald-600' : 'text-amber-600'
        )}>
          <CheckCircle2 className="h-3 w-3" />
          {statusLabel(parseStatus)}
        </div>
      )}

      {task.status === 'error' && (
        <div className="mt-2 flex items-start gap-1.5 text-[11px] text-red-600">
          <AlertCircle className="mt-px h-3 w-3 shrink-0" />
          <span className="break-all">{task.error}</span>
        </div>
      )}

      {(task.status === 'uploading' || task.status === 'queued' || task.status === 'error' || task.status === 'canceled') && (
        <div className="mt-2 flex gap-2">
          {task.status === 'uploading' || task.status === 'queued' ? (
            <button
              type="button"
              onClick={() => onCancel(task.id)}
              className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-[11px] font-medium text-gray-700 shadow-sm"
            >
              <Ban className="h-3 w-3" /> 取消
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onRetry(task.id)}
              className="flex items-center gap-1 rounded-lg bg-brand-600 px-2 py-1 text-[11px] font-medium text-white"
            >
              <RotateCcw className="h-3 w-3" /> 重试
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// 上传任务面板：真实上传进度 + 上传完成后的服务端解析状态。
// parseStatusOf(knowledgeId) 由父级从文档列表里取，保证面板与列表状态一致。
function UploadTaskPanel({ tasks, summary, parseStatusOf, onCancel, onRetry, onRemove, onClearFinished }) {
  const [collapsed, setCollapsed] = useState(false);

  if (!tasks || tasks.length === 0) return null;

  const overallPct = summary.total === 0 ? 0 : Math.round((summary.finished / summary.total) * 100);

  return (
    <div className="rounded-2xl bg-white p-3 shadow-card">
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center gap-2 text-left"
      >
        <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-50 px-1.5 text-[11px] font-semibold text-brand-600">
          {summary.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : summary.total}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-gray-900">
            上传任务
            {summary.busy
              ? ` · 进行中 ${summary.uploading + summary.queued}`
              : ` · 完成 ${summary.finished}/${summary.total}`}
          </span>
          <span className="mt-0.5 block text-[11px] text-gray-500">
            已上传 {summary.uploaded}
            {summary.failed > 0 && ` · 失败 ${summary.failed}`}
            {summary.canceled > 0 && ` · 已取消 ${summary.canceled}`}
          </span>
        </span>
        {collapsed ? <ChevronDown className="h-4 w-4 text-gray-400" /> : <ChevronUp className="h-4 w-4 text-gray-400" />}
      </button>

      <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-brand-500 transition-all duration-300" style={{ width: `${overallPct}%` }} />
      </div>

      {!collapsed && (
        <>
          <div className="mt-3 space-y-2">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                parseStatus={task.knowledgeId ? (parseStatusOf?.(task.knowledgeId) || task.parseStatus || null) : null}
                onCancel={onCancel}
                onRetry={onRetry}
                onRemove={onRemove}
              />
            ))}
          </div>

          {summary.hasFinished && (
            <button
              type="button"
              onClick={onClearFinished}
              className="mt-3 flex w-full items-center justify-center gap-1 rounded-xl bg-surface-subtle py-2 text-xs font-medium text-gray-700"
            >
              <Trash2 className="h-3.5 w-3.5" /> 清除已完成
            </button>
          )}
        </>
      )}
    </div>
  );
}

export default UploadTaskPanel;
