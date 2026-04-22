import { getArticleList } from '~/apis';
import {
  type CommentMonitorTask,
  getCommentMonitorTasksByFakeid,
  getCommentMonitorTasksByStatus,
  updateCommentMonitorTask,
} from '~/store/v2/commentMonitorTask';
import { findValidCredential } from '~/utils/credentials';
import { syncMonitorTaskComments } from '~/utils/monitor/task-sync';

/** 默认刷新周期：60 秒 */
const DEFAULT_INTERVAL_MS = 60 * 1000;

export interface CommentMonitorSchedulerEvents {
  /** 一次累积同步成功 */
  'task-synced': (taskId: number, totalCount: number) => void;
  /** 任务从 tracking 切到 final_collecting */
  'tracking-complete': (taskId: number) => void;
  /** 一次最终采集完成，任务进入 done */
  'task-finalized': (task: CommentMonitorTask) => void;
  /** 一次同步或最终采集失败 */
  'task-error': (taskId: number, error: Error) => void;
  /** 任务因 fakeid 缺有效 credential 进入 awaiting_credential */
  'task-awaiting-credential': (taskId: number, fakeid: string) => void;
  /** 某个 fakeid 的 awaiting 任务被新到达的 credential 唤醒并同步成功，切回 tracking */
  'task-resumed': (taskId: number) => void;
}

type ListenerMap = { [K in keyof CommentMonitorSchedulerEvents]?: CommentMonitorSchedulerEvents[K][] };

/** 判断错误是否属于 "目标 fakeid credential 缺失/无效"，用于把任务降级到 awaiting_credential */
function isCredentialMissingError(error: Error): boolean {
  return /Credential\s*(未设置|可能已过期)|未能修复文章\s*fakeid/i.test(error.message);
}

export class CommentMonitorScheduler {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private listeners: ListenerMap = {};
  private working = false;
  private readonly intervalMs: number;

  constructor(intervalMs = DEFAULT_INTERVAL_MS) {
    this.intervalMs = intervalMs;
  }

  on<K extends keyof CommentMonitorSchedulerEvents>(event: K, fn: CommentMonitorSchedulerEvents[K]) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event]!.push(fn);
  }

  removeAllListeners() {
    this.listeners = {};
  }

  private emit<K extends keyof CommentMonitorSchedulerEvents>(
    event: K,
    ...args: Parameters<CommentMonitorSchedulerEvents[K]>
  ) {
    for (const fn of this.listeners[event] ?? []) {
      (fn as (...a: any[]) => void)(...args);
    }
  }

  start() {
    if (this.intervalId) return;
    this.tick();
    this.intervalId = setInterval(() => this.tick(), this.intervalMs);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibility);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibility);
    }
  }

  isRunning() {
    return this.intervalId !== null;
  }

  private handleVisibility = () => {
    if (document.hidden) {
      if (this.intervalId) {
        clearInterval(this.intervalId);
        this.intervalId = null;
      }
    } else {
      this.tick();
      this.intervalId = setInterval(() => this.tick(), this.intervalMs);
    }
  };

  private async tick() {
    if (this.working) return;
    this.working = true;
    try {
      // 1. tracking：到时切 final_collecting；否则先校验 credential 再同步
      const trackingTasks = await getCommentMonitorTasksByStatus('tracking');
      for (const task of trackingTasks) {
        if (Date.now() >= task.tracking_end_at) {
          await updateCommentMonitorTask(task.id!, { status: 'final_collecting' });
          this.emit('tracking-complete', task.id!);
          continue;
        }
        if (task.auto_track_enabled === false) continue;

        if (!findValidCredential(task.fakeid)) {
          await this.transitionToAwaitingCredential(task);
          continue;
        }

        await this.syncTrackingTask(task);
      }

      // 2. awaiting_credential：仅检查是否到时进入 final_collecting；其余等 wake
      const awaitingTasks = await getCommentMonitorTasksByStatus('awaiting_credential');
      for (const task of awaitingTasks) {
        if (Date.now() >= task.tracking_end_at) {
          await updateCommentMonitorTask(task.id!, { status: 'final_collecting' });
          this.emit('tracking-complete', task.id!);
        }
      }

      // 3. final_collecting：包括上面同轮刚切过去的
      const finalizingTasks = await getCommentMonitorTasksByStatus('final_collecting');
      for (const task of finalizingTasks) {
        await this.finalizeTask(task);
      }
    } finally {
      this.working = false;
    }
  }

  private async transitionToAwaitingCredential(task: CommentMonitorTask) {
    if (task.status === 'awaiting_credential') return;
    await updateCommentMonitorTask(task.id!, { status: 'awaiting_credential' });
    this.emit('task-awaiting-credential', task.id!, task.fakeid);
  }

  private async syncTrackingTask(task: CommentMonitorTask) {
    try {
      const result = await syncMonitorTaskComments(task);
      this.emit('task-synced', task.id!, result.mergedComments.length);
    } catch (err) {
      const error = err as Error;
      if (isCredentialMissingError(error)) {
        await this.transitionToAwaitingCredential(task);
        return;
      }
      this.emit('task-error', task.id!, error);
    }
  }

  /**
   * 由外部（前端 credential 到达事件）调用：唤醒指定 fakeid 下所有 awaiting_credential 任务，
   * 立即执行一次同步；成功则切回 tracking，仍失败则保持 awaiting_credential。
   */
  async wakeAwaitingByFakeid(fakeid: string): Promise<void> {
    if (!findValidCredential(fakeid)) return;
    const tasks = await getCommentMonitorTasksByFakeid(fakeid);
    const awaiting = tasks.filter(t => t.status === 'awaiting_credential');
    for (const task of awaiting) {
      try {
        const result = await syncMonitorTaskComments(task);
        await updateCommentMonitorTask(task.id!, { status: 'tracking' });
        this.emit('task-resumed', task.id!);
        this.emit('task-synced', task.id!, result.mergedComments.length);
      } catch (err) {
        const error = err as Error;
        if (isCredentialMissingError(error)) {
          // 服务端仍拒绝，保持 awaiting_credential 等待下一次 credential
          continue;
        }
        this.emit('task-error', task.id!, error);
      }
    }
  }

  private async finalizeTask(task: CommentMonitorTask) {
    try {
      await updateCommentMonitorTask(task.id!, { status: 'exporting' });

      const stats = await this.fetchArticleStats(task);
      const result = await syncMonitorTaskComments(task);
      const finalComments = result.latestComments;

      const shielded = result.mergedComments.filter(ac => !finalComments.some(fc => fc.content_id === ac.content_id));

      await updateCommentMonitorTask(task.id!, {
        final_comments: finalComments,
        shielded_comments: shielded,
        stats,
        status: 'done',
      });

      const updated: CommentMonitorTask = {
        ...result.task,
        final_comments: finalComments,
        shielded_comments: shielded,
        stats,
        status: 'done',
      };
      this.emit('task-finalized', updated);
    } catch (err) {
      await updateCommentMonitorTask(task.id!, {
        status: 'error',
        error_msg: (err as Error).message,
      });
      this.emit('task-error', task.id!, err as Error);
    }
  }

  private async fetchArticleStats(task: CommentMonitorTask) {
    try {
      const account = { fakeid: task.fakeid, nickname: task.nickname, round_head_img: '' };
      const [articles] = await getArticleList(account as any, 0);
      const target = articles.find(a => a.aid === task.article_aid);
      if (target) {
        return {
          read_num: (target as any).read_num,
          like_num: (target as any).like_num,
          old_like_num: (target as any).old_like_num,
        };
      }
    } catch {
      // stats are non-critical
    }
    return {};
  }
}
