import { formatTimeStamp } from '#shared/utils/helpers';
import { getCommentCache } from '~/store/v2/comment';
import { getCommentReplyCache } from '~/store/v2/comment_reply';
import { getMetadataCache } from '~/store/v2/metadata';

/**
 * 从文章 HTML 中提取 comment_id。
 * 文本分享与普通图文的页面结构不同，因此需要兼容多种写法。
 */
export function extractCommentId(html: string): string | null {
  const patterns = [
    // 普通图文: var comment_id = 'xxx' || '0';
    /var comment_id = '(?<comment_id>\d+)' \|\| '0';/,
    // 文本分享等: d.comment_id = xml ? getXmlValue('comment_id.DATA') : 'xxx';
    /comment_id:\s*JsDecode\('(?<comment_id>\d+)'\)/,
    // 有些模板里以 JsDecode 形式写在配置里
    /d\.comment_id\s*=\s*xml \? getXmlValue\('comment_id\.DATA'\) : '(?<comment_id>\d+)';/,
    // window.comment_id = 'xxx';
    /window\.comment_id\s*=\s*'(?<comment_id>\d+)'/,
    // var comment_id = "xxx" (双引号变体)
    /var\s+comment_id\s*=\s*"(?<comment_id>\d+)"/,
    // comment_id = 'xxx' (无 var 声明)
    /[^.]comment_id\s*=\s*'(?<comment_id>\d+)'/,
    // comment_id: 'xxx' (对象属性)
    /comment_id:\s*'(?<comment_id>\d+)'/,
    // comment_id: "xxx" (对象属性，双引号)
    /comment_id:\s*"(?<comment_id>\d+)"/,
    // "comment_id":"xxx" (JSON 格式)
    /"comment_id"\s*:\s*"(?<comment_id>\d+)"/,
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      if ('groups' in match && match.groups && match.groups.comment_id) {
        return match.groups.comment_id;
      }
      if (match[1]) {
        return match[1];
      }
    }
  }

  return null;
}

/**
 * 从文章 HTML 中提取真实的 biz / mid(appmsgid) / idx(itemidx)。
 * 微信文章顶部都会有形如 `var biz = ""||"MzUx..."` 这样的脚本块，
 * 同一个变量常见多个 `||` 兜底（前几项往往是空串），需要取第一个非空值。
 * 即使用户传入的是 https://mp.weixin.qq.com/s/XXXXX 这种短链，
 * 下载下来的 HTML 仍然包含真实参数；用它们覆盖 URL 解析得到的占位值，
 * 才能让后续 appmsg_comment 接口接受请求（否则返回 ret=-1）。
 */
export function extractArticleMeta(html: string): {
  biz: string | null;
  mid: string | null;
  idx: string | null;
} {
  // 抓 `var X = ... ;` 整段表达式后，从所有 "..." / '...' 字面量里挑第一个非空值。
  // validator 用于过滤 mid/idx 这种必须是数字的场景。
  const pickVarValue = (varName: string, validator?: (v: string) => boolean): string | null => {
    const exprPattern = new RegExp(`(?:var|window\\.)\\s*${varName}\\s*=\\s*([^;]+);`);
    const exprMatch = html.match(exprPattern);
    if (!exprMatch) return null;

    const literals = exprMatch[1].matchAll(/["']([^"']*)["']/g);
    for (const m of literals) {
      const v = m[1].trim();
      if (!v) continue;
      if (validator && !validator(v)) continue;
      return v;
    }
    return null;
  };

  const isDigit = (v: string) => /^\d+$/.test(v);

  const biz =
    pickVarValue('biz') ||
    pickVarValue('__biz') ||
    (() => {
      const m = html.match(/"biz"\s*:\s*"(?<value>[^"]+)"/);
      return m?.groups?.value || null;
    })();

  const mid =
    pickVarValue('mid', isDigit) ||
    pickVarValue('appmsgid', isDigit) ||
    (() => {
      const m = html.match(/"appmsgid"\s*:\s*"?(?<value>\d+)"?/);
      return m?.groups?.value || null;
    })();

  const idx =
    pickVarValue('idx', isDigit) ||
    pickVarValue('itemidx', isDigit) ||
    (() => {
      const m = html.match(/"itemidx"\s*:\s*"?(?<value>\d+)"?/);
      return m?.groups?.value || null;
    })();

  return { biz, mid, idx };
}

/**
 * 渲染文章的评论内容
 * @param url 文章链接
 */
export async function renderCommentSection(
  url: string,
  comments: any[],
  options: {
    title?: string;
    titleColor?: string;
  } = {}
) {
  let commentHTML = '';
  if (comments.length > 0) {
    commentHTML += '<div style="max-width: 667px;margin: 0 auto;padding: 10px 10px 80px;">';
    commentHTML += `<p style="font-size: 15px;color: ${options.titleColor || '#949494'};">${options.title || `留言 ${comments.length}`}</p>`;
    commentHTML += '<div style="margin-top: -10px;">';

    for (const comment of comments) {
      commentHTML += '<div style="margin-top: 25px;"><div style="display: flex;">';
      if ([1, 2].includes(comment.identity_type)) {
        commentHTML += `<img src="${comment.logo_url}" style="display: block;width: 30px;height: 30px;border-radius: 50%;margin-right: 8px;" alt="">`;
      } else {
        commentHTML += `<img src="${comment.logo_url}" style="display: block;width: 30px;height: 30px;border-radius: 2px;margin-right: 8px;" alt="">`;
      }
      commentHTML += '<div style="flex: 1;"><p style="display: flex;line-height: 16px;margin-block: 5px;">';
      commentHTML += `<span style="margin-right: 5px;font-size: 15px;color: #949494;">${comment.nick_name}</span>`;
      if (comment.is_from_friend === 1) {
        commentHTML += `<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">朋友</span>`;
      }
      if (comment.ip_wording) {
        commentHTML += `<span style="margin-right: 5px;font-size: 12px;color: #b5b5b5;">${comment.ip_wording?.province_name}</span>`;
      } else {
        commentHTML += `<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">作者</span>`;
      }
      commentHTML += `<span style="font-size: 12px;color: #b5b5b5;">${formatTimeStamp(comment.create_time)}</span>`;
      commentHTML += '<span style="flex: 1;"></span><span style="display: inline-flex;align-items: center;">';
      commentHTML += `<span class="sns_opr_btn sns_praise_btn" style="font-size: 12px;color: #8b8a8a;">${comment.like_num || ''}</span>`;
      commentHTML += '</span></p>';
      commentHTML += `<p style="font-size: 15px;color: #333;white-space: pre-line;margin-block: .5em;">${comment.content}</p>`;
      if (comment.multi_info && comment.multi_info.pictures && comment.multi_info.pictures.length > 0) {
        commentHTML += `<p>${comment.multi_info.pictures.map((pic: any) => '<img src="' + pic.url + '" style="max-width: 100%;" alt="">').join('')}</p>`;
      }
      if (comment.author_like_status === 1) {
        commentHTML += '<p style="font-size: 12px;color: #00BA5A;margin-block: .5em;">作者赞过</p>';
      }
      commentHTML += '</div></div>';

      let reply_list = [];
      const commentReplyResponse = await getCommentReplyCache(url, comment.content_id);
      if (
        commentReplyResponse &&
        commentReplyResponse.data &&
        commentReplyResponse.data.reply_list.reply_list.length > 0
      ) {
        reply_list = commentReplyResponse.data.reply_list.reply_list;
      } else if (comment.reply_new && comment.reply_new.reply_list.length > 0) {
        reply_list = comment.reply_new.reply_list;
      }
      commentHTML += '<div style="padding-left: 38px;">';
      reply_list
        .sort((a: any, b: any) => a.create_time - b.create_time)
        .forEach((reply: any) => {
          commentHTML += '<div style="display: flex;margin-top: 15px;">';
          if ([1, 2].includes(reply.identity_type)) {
            commentHTML += `<img src="${reply.logo_url}" style="display: block;width: 23px;height: 23px;border-radius: 50%;margin-right: 8px;" alt="">`;
          } else {
            commentHTML += `<img src="${reply.logo_url}" style="display: block;width: 23px;height: 23px;border-radius: 2px;margin-right: 8px;" alt="">`;
          }
          commentHTML += '<div style="flex: 1;"><p style="display: flex;line-height: 16px;margin-block: 5px;">';
          commentHTML += `<span style="margin-right: 5px;font-size: 15px;color: #949494;">${reply.nick_name}</span>`;
          if (reply.is_from_friend === 1) {
            commentHTML += `<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">朋友</span>`;
          }
          if (reply.ip_wording) {
            commentHTML += `<span style="margin-right: 5px;font-size: 12px;color: #b5b5b5;">${reply.ip_wording?.province_name}</span>`;
          } else {
            commentHTML += `<span style="margin-right: 5px;font-size: 12px;color: #00BA5A;">作者</span>`;
          }
          commentHTML += `<span style="font-size: 12px;color: #b5b5b5;">${formatTimeStamp(reply.create_time)}</span>`;
          commentHTML +=
            '<span style="flex: 1;"></span><span style="display: inline-flex;align-items: center; font-size: 12px;color: #b5b5b5;">';
          commentHTML += `<span class="sns_opr_btn sns_praise_btn" style="font-size: 12px;color: #8b8a8a;">${reply.reply_like_num || ''}</span>`;
          commentHTML += '</span></p>';
          commentHTML += `<p style="font-size: 15px;color: #333;white-space: pre-line;margin-block: .5em;">${reply.to_nick_name ? '回复 ' + reply.to_nick_name + ':' : ''} ${reply.content}</p>`;
          if (reply.multi_info && reply.multi_info.pictures && reply.multi_info.pictures.length > 0) {
            commentHTML += `<p>${reply.multi_info.pictures.map((pic: any) => '<img src="' + pic.url + '" style="max-width: 100%;" alt="">').join('')}</p>`;
          }
          if (reply.author_like_status === 1) {
            commentHTML += '<p style="font-size: 12px;color: #00BA5A;margin-block: .5em;">作者赞过</p>';
          }
          commentHTML += '</div></div>';
        });
      commentHTML += '</div>';
      commentHTML += '</div>';
    }

    commentHTML += '</div></div>';
  }

  return commentHTML;
}

export async function renderComments(url: string) {
  let elected_comments = [];

  const commentCache = await getCommentCache(url);
  if (commentCache) {
    const commentResponse = commentCache.data;
    if (Array.isArray(commentResponse)) {
      elected_comments = commentResponse.flatMap(response => response.elected_comment);
    } else if (commentResponse) {
      elected_comments = commentResponse.elected_comment;
    }
  }

  if (elected_comments.length === 0) {
    return '';
  }

  const metadata = await getMetadataCache(url);
  return renderCommentSection(url, elected_comments, {
    title: `留言 ${metadata?.commentNum ?? elected_comments.length}`,
  });
}

// 从本地缓存获取文章的评论数据
export async function getArticleComments(url: string) {
  let elected_comments = [];
  const commentCache = await getCommentCache(url);
  if (commentCache) {
    const commentResponse = commentCache.data;
    if (Array.isArray(commentResponse)) {
      elected_comments = commentResponse.flatMap(response => response.elected_comment);
    } else if (commentResponse) {
      elected_comments = commentResponse.elected_comment;
    }

    if (elected_comments.length > 0) {
      for (const comment of elected_comments) {
        // 留言回复列表
        let reply_list = [];
        const commentReplyResponse = await getCommentReplyCache(url, comment.content_id);
        if (
          commentReplyResponse &&
          commentReplyResponse.data &&
          commentReplyResponse.data.reply_list.reply_list.length > 0
        ) {
          reply_list = commentReplyResponse.data.reply_list.reply_list;
        } else if (comment.reply_new && comment.reply_new.reply_list.length > 0) {
          reply_list = comment.reply_new.reply_list;
        }
        reply_list.sort((a: any, b: any) => a.create_time - b.create_time);
        comment.$reply_list = reply_list;
      }
    }
  }

  return elected_comments;
}
