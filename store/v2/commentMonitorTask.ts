import type { Comment } from '~/types/comment';
import { db } from './db';

export interface CommentMonitorTaskStats {
  read_num?: number;
  like_num?: number;
  old_like_num?: number;
}

export interface CommentMonitorTask {
  id?: number;
  fakeid: string;
  nickname: string;
  article_url: string;
  article_title: string;
  article_aid: string;
  comment_id: string;
  status: 'tracking' | 'awaiting_credential' | 'final_collecting' | 'exporting' | 'done' | 'error';
  created_at: number;
  tracking_end_at: number;
  accumulated_comments: Comment[];
  final_comments: Comment[];
  shielded_comments: Comment[];
  stats: CommentMonitorTaskStats;
  error_msg: string;
  auto_track_enabled: boolean;
  /** 任务来源：'auto' 来自公众号自动发现；'manual' 由用户手动添加 URL */
  source: 'auto' | 'manual';
  /** 当 source=auto 时，记录触发该任务的公众号 fakeid */
  source_fakeid?: string;
  /** 最近一次成功拉取评论的时间戳；0 表示还未同步过 */
  last_sync_at: number;
}

export async function createCommentMonitorTask(task: Omit<CommentMonitorTask, 'id'>): Promise<number> {
  return db.comment_monitor_task.add(task as CommentMonitorTask) as Promise<number>;
}

export async function getAllCommentMonitorTasks(): Promise<CommentMonitorTask[]> {
  return db.comment_monitor_task.orderBy('created_at').reverse().toArray();
}

export async function getCommentMonitorTasksByStatus(
  status: CommentMonitorTask['status']
): Promise<CommentMonitorTask[]> {
  return db.comment_monitor_task.where('status').equals(status).toArray();
}

export async function getCommentMonitorTasksByFakeid(fakeid: string): Promise<CommentMonitorTask[]> {
  return db.comment_monitor_task.where('fakeid').equals(fakeid).toArray();
}

export async function updateCommentMonitorTask(id: number, changes: Partial<CommentMonitorTask>): Promise<void> {
  await db.comment_monitor_task.update(id, changes);
}

export async function deleteCommentMonitorTask(id: number): Promise<void> {
  await db.comment_monitor_task.delete(id);
}
