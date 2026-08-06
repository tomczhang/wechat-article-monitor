import assert from 'node:assert/strict';
import test from 'node:test';
import { isLegacyProfileArticle, migrateLegacyProfileArticleDeletion } from '../utils/profile-getmsg-migration.ts';

function legacyProfileArticle(isDeleted: boolean, copyrightStat: number): Record<string, any> {
  const cover = 'https://example.com/cover.jpg';
  return {
    aid: '2247485222_1',
    album_id: '',
    appmsg_album_infos: [],
    ban_flag: 0,
    checking: 0,
    copyright_stat: copyrightStat,
    copyright_type: copyrightStat,
    cover,
    cover_img: cover,
    create_time: 1785806269,
    update_time: 1785806269,
    is_deleted: isDeleted,
    mediaapi_publish_status: 0,
    pic_cdn_url_1_1: cover,
    pic_cdn_url_3_4: cover,
    pic_cdn_url_16_9: cover,
    pic_cdn_url_235_1: cover,
  };
}

test('repairs inverted profile deletion states only when the raw flags were persisted', () => {
  const normal = { ...legacyProfileArticle(true, 11), _profile_del_flag: 1, _status: '' };
  const deleted = { ...legacyProfileArticle(false, 100), _profile_del_flag: 4 };

  assert.equal(migrateLegacyProfileArticleDeletion(normal), true);
  assert.equal(normal.is_deleted, false);
  assert.equal(normal._source, 'profile_ext');
  assert.equal(normal._profile_del_flag, 1);

  assert.equal(migrateLegacyProfileArticleDeletion(deleted), true);
  assert.equal(deleted.is_deleted, true);
  assert.equal(deleted._source, 'profile_ext');
  assert.equal(deleted._profile_del_flag, 4);
});

test('leaves ambiguous, corrected, and other-source records unchanged', () => {
  const single = { ...legacyProfileArticle(false, 100), _profile_del_flag: 4, _single: true };
  const publisher = legacyProfileArticle(true, 11);
  const missingFlag = legacyProfileArticle(false, 100);
  const unknownFlag = { ...legacyProfileArticle(false, 100), _profile_del_flag: 99 };
  const correctedNormal = { ...legacyProfileArticle(false, 11), _profile_del_flag: 1 };
  const correctedDeleted = { ...legacyProfileArticle(true, 100), _profile_del_flag: 4 };
  const downloaded = { ...legacyProfileArticle(true, 11), _profile_del_flag: 1, _status: '正常' };
  const alreadyMigrated = {
    ...legacyProfileArticle(false, 100),
    _profile_del_flag: 4,
    _source: 'profile_ext' as const,
  };

  for (const article of [
    single,
    publisher,
    missingFlag,
    unknownFlag,
    correctedNormal,
    correctedDeleted,
    downloaded,
    alreadyMigrated,
  ]) {
    const before = structuredClone(article);
    assert.equal(isLegacyProfileArticle(article), false);
    assert.equal(migrateLegacyProfileArticleDeletion(article), false);
    assert.deepEqual(article, before);
  }
});
