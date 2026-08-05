import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

test('album page uses the shared article grab and export pipeline', async () => {
  const source = await readFile(new URL('../pages/dashboard/album.vue', import.meta.url), 'utf8');

  assert.match(source, /useDownloader\(/);
  assert.match(source, /useExporter\(/);
  assert.match(source, /collectCompleteAlbum\(/);
  assert.match(source, /cacheMissingAlbumArticles\(/);
  assert.match(source, /downloadAlbumArticles\('html'\)/);
  assert.match(source, /downloadAlbumArticles\('metadata'\)/);
  assert.match(source, /downloadAlbumArticles\('comment'\)/);
  assert.match(source, /exportAlbumArticles\('excel'\)/);
  assert.match(source, /exportAlbumArticles\('pdf', true\)/);
  assert.doesNotMatch(source, /useDownloadAlbum|doBatchDownload|抓取全部文章链接|批量下载/);
});

test('album actions prepare the complete album before invoking shared capabilities', async () => {
  const source = await readFile(new URL('../pages/dashboard/album.vue', import.meta.url), 'utf8');

  assert.match(source, /async function prepareAlbumArticles\(\)/);
  assert.match(source, /const urls = await prepareAlbumArticles\(\)/g);
  assert.match(source, /findValidCredential\(account\.fakeid\)/);
  assert.match(source, /openGate\(\{ fakeid: account\.fakeid, refresh: true \}\)/);
  assert.match(source, /getHtmlCache\(url\)/);
});

test('album pagination stalls cannot be treated as complete or silently exported', async () => {
  const source = await readFile(new URL('../pages/dashboard/album.vue', import.meta.url), 'utf8');
  const stallStart = source.indexOf('if (page.hasMore && newItems.length === 0)');

  assert.ok(stallStart >= 0);
  assert.doesNotMatch(source.slice(stallStart, stallStart + 300), /noMoreData\.value = true/);
  assert.match(source, /paginationError/);
  assert.match(source, /!paginationError\.value/);
});

test('album cache insertion is atomic and never overwrites an occupied article key', async () => {
  const source = await readFile(new URL('../pages/dashboard/album.vue', import.meta.url), 'utf8');

  assert.match(source, /db\.transaction\('rw', db\.article/);
  assert.match(source, /bulkAdd\(/);
  assert.doesNotMatch(source, /bulkPut\(/);
  assert.match(source, /resolvedUrls/);
});

test('obsolete HTML-only album batch composable is removed', async () => {
  await assert.rejects(
    access(new URL('../composables/useBatchDownload.ts', import.meta.url)),
    (error: NodeJS.ErrnoException) => error.code === 'ENOENT'
  );
});
