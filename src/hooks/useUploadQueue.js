import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { uploadFileWithProgress } from '../api/client.js';

// 上传任务状态机：
//   queued    排队中
//   uploading 上传中（progress 为真实百分比）
//   uploaded  已上传，后端已受理，解析由服务端自动开始（待 onUploaded 回填解析状态）
//   error     上传失败，可重试
//   canceled  用户取消
const UPLOADING = 'uploading';
const QUEUED = 'queued';

let seq = 0;
function nextId() {
  seq += 1;
  return `up_${Date.now().toString(36)}_${seq}`;
}

// 串行上传队列。
//
// 为什么串行（并发 1）而不是并发上传：
// 1) 手机网络抖动严重，并发上传会互相抢带宽，进度条全部卡在 30% 反而让人以为卡死；
// 2) WebView 单域名连接数有限，并发上传会和列表/图片请求互相排队；
// 3) 串行可保证「取消」语义干净：任意时刻只有一个可中断的传输。
export function useUploadQueue({ kbId, onUploaded } = {}) {
  const [tasks, setTasks] = useState([]);
  const controllersRef = useRef(new Map());
  const startedRef = useRef(new Set());
  const kbIdRef = useRef(kbId);
  const onUploadedRef = useRef(onUploaded);
  kbIdRef.current = kbId;
  onUploadedRef.current = onUploaded;

  const patch = useCallback((id, changes) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
  }, []);

  const enqueue = useCallback((fileList) => {
    const files = Array.from(fileList || []).filter(Boolean);
    if (files.length === 0) return [];
    const created = files.map((file) => ({
      id: nextId(),
      file,
      name: file.name,
      size: file.size,
      status: QUEUED,
      progress: 0,
      error: null,
      knowledgeId: null,
      addedAt: Date.now(),
      finishedAt: null
    }));
    setTasks((prev) => [...prev, ...created]);
    return created.map((t) => t.id);
  }, []);

  const runTask = useCallback(async (task) => {
    // 防重复启动：StrictMode 的挂载/卸载检查、以及错误边界重挂载都可能让
    // 同一个任务被推进两次；这里用 ref 做同步去重，避免同一文件被上传两遍。
    if (startedRef.current.has(task.id)) return null;
    startedRef.current.add(task.id);

    const controller = new AbortController();
    controllersRef.current.set(task.id, controller);

    patch(task.id, { status: UPLOADING, progress: 0, error: null, startedAt: Date.now() });

    let lastPct = 0;
    try {
      const res = await uploadFileWithProgress(kbIdRef.current, task.file, {
        channel: 'mobile',
        signal: controller.signal,
        onProgress: (loaded, total) => {
          if (!total) return;
          const pct = Math.min(99, Math.round((loaded / total) * 100)); // 100% 留给服务端确认
          // 进度节流：变化不足 1% 不触发重渲染（大文件时事件会非常密集）
          if (pct === lastPct) return;
          lastPct = pct;
          patch(task.id, { progress: pct });
        }
      });

      const knowledge = res?.data || res;
      const knowledgeId = knowledge?.id || null;
      patch(task.id, {
        status: 'uploaded',
        progress: 100,
        knowledgeId,
        parseStatus: knowledge?.parse_status || 'pending',
        finishedAt: Date.now()
      });
      onUploadedRef.current?.(knowledge, task);
      return true;
    } catch (err) {
      const isAbort = err?.name === 'AbortError';
      patch(task.id, {
        status: isAbort ? 'canceled' : 'error',
        error: isAbort ? null : (err?.message || '上传失败'),
        finishedAt: Date.now()
      });
      return false;
    } finally {
      controllersRef.current.delete(task.id);
    }
  }, [patch]);

  // 串行泵：任一时刻只推进一个任务，完成/失败后自动取下一个排队任务
  const activeTask = tasks.find((t) => t.status === UPLOADING);
  useEffect(() => {
    if (!kbIdRef.current) return;
    if (activeTask) return;
    const next = tasks.find((t) => t.status === QUEUED);
    if (!next) return;
    runTask(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks, activeTask, runTask]);

  const cancel = useCallback((id) => {
    const controller = controllersRef.current.get(id);
    if (controller) {
      controller.abort(); // 上传中：中断传输，由 catch 落到 canceled
      return;
    }
    setTasks((prev) => prev.map((t) => (t.id === id && t.status === QUEUED
      ? { ...t, status: 'canceled', finishedAt: Date.now() }
      : t)));
  }, []);

  const retry = useCallback((id) => {
    startedRef.current.delete(id);
    setTasks((prev) => prev.map((t) => (t.id === id
      ? { ...t, status: QUEUED, progress: 0, error: null, finishedAt: null }
      : t)));
  }, []);

  const remove = useCallback((id) => {
    const controller = controllersRef.current.get(id);
    if (controller) controller.abort();
    controllersRef.current.delete(id);
    startedRef.current.delete(id);
    setTasks((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setTasks((prev) => {
      prev.forEach((t) => {
        if (t.status !== UPLOADING && t.status !== QUEUED) startedRef.current.delete(t.id);
      });
      return prev.filter((t) => t.status === UPLOADING || t.status === QUEUED);
    });
  }, []);

  // 注意：这里刻意「不」在卸载时中断在途上传。
  // 上传是用户显式发起的写操作，若用户在上传过程中点开某个文档、切换知识库，
  // 中断会直接丢掉这次上传（且没有任何补偿）。让请求在后台跑完，文档随后会
  // 出现在列表里（服务端已入库），代价只是离开页面后看不到进度、也无法取消。
  // StrictMode 的挂载/卸载检查同样会走到这里，中断实现会让 dev 下所有上传秒失败。

  const summary = useMemo(() => {
    const total = tasks.length;
    const uploading = tasks.filter((t) => t.status === UPLOADING).length;
    const queued = tasks.filter((t) => t.status === QUEUED).length;
    const uploaded = tasks.filter((t) => t.status === 'uploaded').length;
    const failed = tasks.filter((t) => t.status === 'error').length;
    const canceled = tasks.filter((t) => t.status === 'canceled').length;
    return {
      total,
      uploading,
      queued,
      uploaded,
      failed,
      canceled,
      finished: uploaded + failed + canceled,
      busy: uploading + queued > 0,
      hasFinished: total - uploading - queued > 0
    };
  }, [tasks]);

  return { tasks, enqueue, cancel, retry, remove, clearFinished, summary };
}

export default useUploadQueue;
