type MutableArticle = Record<string, unknown> & {
  is_deleted?: boolean;
  _source?: string;
  _profile_del_flag?: number;
};

export function isLegacyProfileArticle(article: MutableArticle): boolean {
  const cover = article.cover;
  const hasInvertedDeletionState =
    (article._profile_del_flag === 1 && article.is_deleted === true) ||
    (article._profile_del_flag === 4 && article.is_deleted === false);

  return (
    article._source === undefined &&
    article._single !== true &&
    (article._status === undefined || article._status === '') &&
    hasInvertedDeletionState &&
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

  article.is_deleted = article._profile_del_flag === 4;
  article._source = 'profile_ext';
  return true;
}
