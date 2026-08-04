type MutableArticle = Record<string, unknown> & {
  is_deleted?: boolean;
  _source?: string;
  _profile_del_flag?: number;
};

export function isLegacyProfileArticle(article: MutableArticle): boolean {
  const cover = article.cover;
  return (
    article._source === undefined &&
    article._single !== true &&
    typeof article.is_deleted === 'boolean' &&
    article.album_id === '' &&
    Array.isArray(article.appmsg_album_infos) &&
    article.appmsg_album_infos.length === 0 &&
    article.ban_flag === 0 &&
    article.checking === 0 &&
    article.mediaapi_publish_status === 0 &&
    article.create_time === article.update_time &&
    article.cover_img === cover &&
    article.pic_cdn_url_1_1 === cover &&
    article.pic_cdn_url_3_4 === cover &&
    article.pic_cdn_url_16_9 === cover &&
    article.pic_cdn_url_235_1 === cover &&
    article.copyright_type === article.copyright_stat
  );
}

export function migrateLegacyProfileArticleDeletion(article: MutableArticle): boolean {
  if (!isLegacyProfileArticle(article)) return false;

  const oldDeleted = article.is_deleted === true;
  article.is_deleted = !oldDeleted;
  article._source = 'profile_ext';
  article._profile_del_flag = oldDeleted ? 1 : 4;
  return true;
}
