import toastFactory from '~/composables/toast';
import {
  type CommentMonitorTask,
  createCommentMonitorTask,
  deleteCommentMonitorTask,
  getAllCommentMonitorTasks,
  updateCommentMonitorTask,
} from '~/store/v2/commentMonitorTask';
import type { WatchedAccount } from '~/store/v2/watchedAccount';
import type { ParsedCredential } from '~/types/credential';
import type { AppMsgEx } from '~/types/types';
import { extractCommentId } from '~/utils/comment';
import { downloadArticleHTML } from '~/utils/index';
import { CommentMonitorScheduler } from '~/utils/monitor/CommentMonitorScheduler';
import { generateMonitorHtml, generateMonitorMarkdown } from '~/utils/monitor/MonitorExporter';
import { ensureMonitorTaskArticleStub, parseArticleUrlMeta, syncMonitorTaskComments } from '~/utils/monitor/task-sync';

const TRACKING_DURATION_MS = 1.5 * 60 * 60 * 1000;
/** fakeid 维度的通知节流窗口：5 分钟 */
const NOTIFY_THROTTLE_MS = 5 * 60 * 1000;

const tasks = ref<CommentMonitorTask[]>([]);
const monitoring = ref(false);

let scheduler: CommentMonitorScheduler | null = null;
let schedulerListenersBound = false;
let credentialWatchStop: (() => void) | null = null;
/** fakeid → 上次系统通知发送时间戳，用于跨重复事件去抖 */
const lastNotifiedAt = new Map<string, number>();
/** 上次比对的有效 credential fakeid 集合，diff 出"新到达" */
let lastValidFakeids: Set<string> = new Set();

export default function useCommentMonitor() {
  const toast = toastFactory();

  function downloadBlob(filename: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  function isCredentialExpiredError(error: Error) {
    return /未登录或登录已过期|session expired/i.test(error.message);
  }

  async function refreshTasks() {
    tasks.value = await getAllCommentMonitorTasks();
  }

  async function exportMarkdown(task: CommentMonitorTask) {
    try {
      const md = await generateMonitorMarkdown(task);
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
      downloadBlob(`${task.article_title}-监控报告.md`, blob);
      toast.success('Markdown 导出完成', `【${task.article_title}】已导出`);
    } catch (error) {
      toast.error('Markdown 导出失败', (error as Error).message);
      throw error;
    }
  }

  async function exportPdf(task: CommentMonitorTask) {
    try {
      const html = await generateMonitorHtml(task);
      const response = await fetch('/api/web/pdf/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
        body: html,
      });
      if (!response.ok) {
        throw new Error(`PDF 生成失败: ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      downloadBlob(`${task.article_title}-监控报告.pdf`, blob);
      toast.success('PDF 导出完成', `【${task.article_title}】已导出`);
    } catch (error) {
      toast.error('PDF 导出失败', (error as Error).message);
      throw error;
    }
  }

  function bindSchedulerListeners(s: CommentMonitorScheduler) {
    if (schedulerListenersBound) return;
    schedulerListenersBound = true;

    s.on('task-synced', async () => {
      await refreshTasks();
    });

    s.on('tracking-complete', async () => {
      await refreshTasks();
    });

    s.on('task-finalized', async task => {
      const shieldedCount = task.shielded_comments?.length ?? 0;
      const desc = shieldedCount > 0 ? `检测到 ${shieldedCount} 条被盾评论` : '未检测到被盾评论';
      toast.success('监控完成', `【${task.nickname}】${task.article_title} — ${desc}`);
      await refreshTasks();

      try {
        await exportMarkdown(task);
      } catch {
        console.error(`[CommentMonitor] 自动导出 Markdown 失败: ${task.article_title}`);
      }
      try {
        await exportPdf(task);
      } catch {
        console.error(`[CommentMonitor] 自动导出 PDF 失败: ${task.article_title}`);
      }
    });

    s.on('task-error', async (taskId, error) => {
      const task = tasks.value.find(t => t.id === taskId);
      const taskName = task ? `【${task.article_title}】` : `任务 ${taskId}`;
      console.error(`[CommentMonitor] task error ${taskId}:`, error);
      toast.error('评论监控失败', `${taskName}${error.message}`);
      if (isCredentialExpiredError(error)) {
        stopMonitor();
        toast.warning('评论监控已停止', '检测到登录已过期，请重新扫码登录后再恢复监控');
      }
      await refreshTasks();
    });

    s.on('task-awaiting-credential', async (taskId, fakeid) => {
      await refreshTasks();
      const task = tasks.value.find(t => t.id === taskId);
      if (!task) return;
      maybeNotifyAwaiting(task, fakeid);
    });

    s.on('task-resumed', async taskId => {
      await refreshTasks();
      const task = tasks.value.find(t => t.id === taskId);
      if (task) {
        toast.success('凭证已到达', `【${task.nickname}】${task.article_title} 已恢复同步`);
      }
    });
  }

  /** 满足 tab 失焦 + 已授权 + 节流 时弹一次系统通知，否则静默 */
  function maybeNotifyAwaiting(task: CommentMonitorTask, fakeid: string) {
    if (typeof window === 'undefined' || typeof Notification === 'undefined') return;
    if (!document.hidden) return;
    if (Notification.permission !== 'granted') return;
    const now = Date.now();
    const last = lastNotifiedAt.get(fakeid) ?? 0;
    if (now - last < NOTIFY_THROTTLE_MS) return;
    lastNotifiedAt.set(fakeid, now);
    try {
      new Notification(`等待凭证 — ${task.nickname}`, {
        body: `${task.article_title} 暂无可用凭证，请在手机微信打开一篇该公众号文章`,
        tag: `awaiting-credential:${fakeid}`,
      });
    } catch (err) {
      console.warn('[CommentMonitor] Notification failed:', err);
    }
  }

  /** 监听 localStorage 中的 credential 列表，diff 出新到达的 fakeid 唤醒对应 awaiting 任务 */
  function bindCredentialWatcher() {
    if (credentialWatchStop) return;
    const credentials = useLocalStorage<ParsedCredential[]>('auto-detect-credentials:credentials', []);
    credentialWatchStop = watch(
      credentials,
      list => {
        if (!scheduler) return;
        const validNow = new Set(
          (list ?? []).filter(c => Date.now() < c.timestamp + 1000 * 60 * 25).map(c => c.biz)
        );
        const newlyArrived: string[] = [];
        for (const fakeid of validNow) {
          if (!lastValidFakeids.has(fakeid)) newlyArrived.push(fakeid);
        }
        lastValidFakeids = validNow;
        for (const fakeid of newlyArrived) {
          scheduler.wakeAwaitingByFakeid(fakeid).catch(err => {
            console.warn('[CommentMonitor] wakeAwaitingByFakeid failed:', err);
          });
        }
      },
      { deep: true, immediate: true }
    );
  }

  function startMonitor() {
    if (monitoring.value) {
      if (import.meta.dev) console.warn('[CommentMonitor] already running');
      return;
    }
    scheduler = new CommentMonitorScheduler();
    bindSchedulerListeners(scheduler);
    bindCredentialWatcher();
    scheduler.start();
    monitoring.value = true;
  }

  function stopMonitor() {
    if (scheduler) {
      scheduler.stop();
      scheduler.removeAllListeners();
      scheduler = null;
    }
    if (credentialWatchStop) {
      credentialWatchStop();
      credentialWatchStop = null;
    }
    schedulerListenersBound = false;
    monitoring.value = false;
  }

  /** 公众号自动发现入队：创建一条 source=auto 任务并立即同步一次评论 */
  async function enqueueAuto(article: AppMsgEx, watch: WatchedAccount) {
    const now = Date.now();
    const task: Omit<CommentMonitorTask, 'id'> = {
      fakeid: watch.fakeid,
      nickname: watch.nickname,
      article_url: article.link,
      article_title: article.title,
      article_aid: article.aid,
      comment_id: '',
      status: 'tracking',
      created_at: now,
      tracking_end_at: now + TRACKING_DURATION_MS,
      accumulated_comments: [],
      final_comments: [],
      shielded_comments: [],
      stats: {},
      error_msg: '',
      auto_track_enabled: true,
      source: 'auto',
      source_fakeid: watch.fakeid,
      last_sync_at: 0,
    };
    const id = await createCommentMonitorTask(task);
    const created = { ...task, id };
    await refreshTasks();

    toast.success('新文章', `【${watch.nickname}】${article.title}`);

    if (!monitoring.value) startMonitor();

    try {
      await syncMonitorTaskComments(created);
      await refreshTasks();
    } catch (err) {
      console.warn(`[CommentMonitor] 初始同步失败: ${article.title}`, err);
      toast.warning('初始同步失败', `【${article.title}】将由后台调度器重试：${(err as Error).message}`);
    }
  }

  async function addManualArticle(articleUrl: string) {
    try {
      toast.info('正在加载文章...', '通过代理下载文章 HTML');

      const html = await downloadArticleHTML(articleUrl);
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const title = doc.querySelector('#activity-name')?.textContent?.trim() || '未知标题';
      const nickname = doc.querySelector('#js_name')?.textContent?.trim() || '未知公众号';
      const { fakeid, aid } = parseArticleUrlMeta(articleUrl);
      const commentId = extractCommentId(html) || '';

      const now = Date.now();
      const task: Omit<CommentMonitorTask, 'id'> = {
        fakeid,
        nickname,
        article_url: articleUrl,
        article_title: title,
        article_aid: aid,
        comment_id: commentId,
        status: 'tracking',
        created_at: now,
        tracking_end_at: now + TRACKING_DURATION_MS,
        accumulated_comments: [],
        final_comments: [],
        shielded_comments: [],
        stats: {},
        error_msg: '',
        auto_track_enabled: true,
        source: 'manual',
        last_sync_at: 0,
      };

      const id = await createCommentMonitorTask(task);
      const created = { ...task, id };
      await ensureMonitorTaskArticleStub(created);
      await refreshTasks();

      if (!monitoring.value) startMonitor();

      toast.success('添加成功', `【${nickname}】${title}，正在自动抓取评论...`);
      try {
        const result = await syncMonitorTaskComments(created);
        await refreshTasks();
        toast.success('评论抓取完成', `获取到 ${result.latestComments.length} 条评论`);
      } catch (e) {
        const errMsg = (e as Error).message;
        const isCredentialIssue = /Credential|未设置/i.test(errMsg);
        toast.warning(
          isCredentialIssue ? '添加成功，但无法抓取评论' : '评论抓取失败',
          `${errMsg}${isCredentialIssue ? '，请先配置该公众号的 Credential' : '，可稍后手动抓取'}`
        );
      }
    } catch (err) {
      toast.error('添加失败', (err as Error).message);
    }
  }

  async function fetchTaskComments(taskId: number) {
    const task = tasks.value.find(t => t.id === taskId);
    if (!task) return;
    try {
      const result = await syncMonitorTaskComments(task);
      await refreshTasks();
      toast.success(
        '获取评论成功',
        `本次获取 ${result.latestComments.length} 条，累计 ${result.mergedComments.length} 条评论`
      );
    } catch (e) {
      toast.error('获取评论失败', (e as Error).message);
    }
  }

  async function retryTask(taskId: number) {
    await updateCommentMonitorTask(taskId, { status: 'final_collecting', error_msg: '' });
    await refreshTasks();
  }

  async function toggleAutoTrack(taskId: number, enabled: boolean) {
    await updateCommentMonitorTask(taskId, { auto_track_enabled: enabled });
    await refreshTasks();
  }

  async function removeTask(taskId: number) {
    await deleteCommentMonitorTask(taskId);
    await refreshTasks();
  }

  const awaitingTasks = computed(() => tasks.value.filter(t => t.status === 'awaiting_credential'));
  const awaitingCredentialCount = computed(() => awaitingTasks.value.length);
  const awaitingByAccount = computed(() => {
    const map = new Map<string, { fakeid: string; nickname: string; count: number }>();
    for (const t of awaitingTasks.value) {
      const entry = map.get(t.fakeid);
      if (entry) {
        entry.count += 1;
      } else {
        map.set(t.fakeid, { fakeid: t.fakeid, nickname: t.nickname, count: 1 });
      }
    }
    return Array.from(map.values());
  });

  return {
    tasks,
    monitoring,
    awaitingCredentialCount,
    awaitingByAccount,
    addManualArticle,
    enqueueAuto,
    removeTask,
    retryTask,
    toggleAutoTrack,
    fetchTaskComments,
    exportMarkdown,
    exportPdf,
    startMonitor,
    stopMonitor,
    refreshTasks,
  };
}

/** 启动时若已有 tracking / final_collecting 任务，自动启动调度器 */
export function autoStartCommentMonitorIfNeeded() {
  if (monitoring.value || scheduler) return;
  getAllCommentMonitorTasks().then(list => {
    tasks.value = list;
    const hasActive = list.some(t => t.status === 'tracking' || t.status === 'final_collecting');
    if (hasActive) {
      const inst = useCommentMonitor();
      inst.startMonitor();
    }
  });
}
