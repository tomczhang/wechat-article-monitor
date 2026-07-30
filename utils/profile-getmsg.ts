import type {
  ParsedProfileGetMsg,
  ParsedProfileGetMsgList,
  ProfileGetMsgAppMsgItem,
  ProfileGetMsgResponse,
} from '~/types/profile_getmsg';
import type { AppMsgEx, PublishPage } from '~/types/types';

function decodeHtmlEntities(value = ''): string {
  return value.replaceAll('&amp;', '&').replaceAll('&#38;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
}

function getArticleIdentity(url: string, fallbackAppmsgid: number, fallbackItemidx: number) {
  try {
    const params = new URL(url).searchParams;
    const appmsgid = Number(params.get('mid') || params.get('appmsgid')) || fallbackAppmsgid;
    const itemidx = Number(params.get('idx') || params.get('itemidx')) || fallbackItemidx;
    return { appmsgid, itemidx };
  } catch {
    return { appmsgid: fallbackAppmsgid, itemidx: fallbackItemidx };
  }
}

function formatDuration(duration = 0): string {
  const seconds = Math.max(0, Math.floor(duration));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function toAppMsgEx(
  item: ProfileGetMsgAppMsgItem,
  message: ParsedProfileGetMsg,
  fallbackItemidx: number
): AppMsgEx | null {
  const link = decodeHtmlEntities(item.content_url);
  if (!link) return null;

  const createTime = Number(message.comm_msg_info.datetime) || 0;
  const fallbackAppmsgid = Number(message.comm_msg_info.id) || 0;
  const { appmsgid, itemidx } = getArticleIdentity(link, fallbackAppmsgid, fallbackItemidx);
  const cover = decodeHtmlEntities(item.cover);

  return {
    aid: `${appmsgid}_${itemidx}`,
    album_id: '',
    appmsg_album_infos: [],
    appmsgid,
    author_name: item.author || '',
    ban_flag: 0,
    checking: 0,
    copyright_stat: item.copyright_stat || 0,
    copyright_type: item.copyright_stat || 0,
    cover,
    cover_img: cover,
    cover_img_theme_color: undefined,
    create_time: createTime,
    digest: item.digest || '',
    has_red_packet_cover: 0,
    is_deleted: item.del_flag === 1,
    is_pay_subscribe: item.is_pay_subscribe || 0,
    wecoin_count: 0,
    item_show_type: item.item_show_type || 0,
    itemidx,
    link,
    media_duration: formatDuration(item.duration),
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: cover,
    pic_cdn_url_3_4: cover,
    pic_cdn_url_16_9: cover,
    pic_cdn_url_235_1: cover,
    title: item.title || '',
    update_time: createTime,
  };
}

export function parseProfileGetMsgList(generalMsgList: string): ParsedProfileGetMsg[] {
  if (!generalMsgList) return [];

  const parsed = JSON.parse(generalMsgList) as ParsedProfileGetMsg[] | ParsedProfileGetMsgList;
  if (Array.isArray(parsed)) return parsed;
  return Array.isArray(parsed.list) ? parsed.list : [];
}

export function convertProfileGetMsgResponse(response: ProfileGetMsgResponse, begin: number, knownTotal = 0) {
  const messages = parseProfileGetMsgList(response.general_msg_list);
  const articleGroups = messages
    .map(message => {
      const primary = message.app_msg_ext_info;
      if (!primary) return [];

      const items: ProfileGetMsgAppMsgItem[] = [primary, ...(primary.multi_app_msg_item_list || [])];
      return items
        .map((item, index) => toAppMsgEx(item, message, index + 1))
        .filter((article): article is AppMsgEx => article !== null);
    })
    .filter(group => group.length > 0);

  const articles = articleGroups.flat();
  const nextBegin = Number(response.next_offset) || begin + articleGroups.length;
  const completed = Number(response.can_msg_continue) === 0 || messages.length === 0;
  const totalCount = completed ? nextBegin : Math.max(knownTotal, nextBegin + 1);

  const publishPage: PublishPage = {
    featured_count: 0,
    masssend_count: totalCount,
    publish_count: articleGroups.length,
    publish_list: articleGroups.map(group => ({
      publish_type: 1,
      publish_info: JSON.stringify({ appmsgex: group }),
    })),
    total_count: totalCount,
  };

  return { articles, completed, nextBegin, publishPage };
}
