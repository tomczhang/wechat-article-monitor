/** 同号同标题的重发判定窗口：30 分钟 */
const REPOST_WINDOW_SECONDS = 30 * 60;

interface RepostCandidate {
  fakeid: string;
  title: string;
  update_time: number;
}

/**
 * 折叠公众号「删了重发」产生的同名记录。
 *
 * 同一个号、同一个标题、发布时间相差在 30 分钟内的，视为同一篇文章的多次群发，只保留最新那条。
 * 微信历史消息接口会把每次群发都返回一遍，而且不一定给旧的那几次打 del_flag，
 * 所以靠「隐藏已删除」过滤不掉。这里只影响展示，不动 IndexedDB 里的数据。
 */
export function collapseReposts<T extends RepostCandidate>(articles: T[]): T[] {
  const keptTimesByGroup = new Map<string, number[]>();
  const keptIndexes = new Set<number>();

  // 按发布时间倒序决定去留，保证每组留下的是最新的那条
  const ordered = articles
    .map((article, index) => ({ article, index }))
    .sort((a, b) => (b.article.update_time ?? 0) - (a.article.update_time ?? 0));

  for (const { article, index } of ordered) {
    const groupKey = `${article.fakeid}\u0000${article.title}`;
    const time = article.update_time ?? 0;
    const keptTimes = keptTimesByGroup.get(groupKey);

    if (keptTimes) {
      if (keptTimes.some(kept => Math.abs(kept - time) <= REPOST_WINDOW_SECONDS)) continue;
      keptTimes.push(time);
    } else {
      keptTimesByGroup.set(groupKey, [time]);
    }
    keptIndexes.add(index);
  }

  return articles.filter((_, index) => keptIndexes.has(index));
}
