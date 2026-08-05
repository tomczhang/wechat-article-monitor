import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { icons as lucideIcons } from '@iconify-json/lucide';
import { nextTick, ref } from 'vue';
import { watchArticleTableReloads } from '../composables/watchArticleTableReloads.ts';

test('article table reloads initially and only when the selected account identity changes', async () => {
  const selectedAccount = ref<{ fakeid: string } | undefined>({ fakeid: 'account-a' });
  const autoSyncingBiz = ref<string | null>(null);
  const reloaded: string[] = [];
  const stop = watchArticleTableReloads({
    selectedAccount,
    autoSyncingBiz,
    onAccountUnavailable() {},
    onReload: fakeid => reloaded.push(fakeid),
  });

  assert.deepEqual(reloaded, ['account-a']);

  selectedAccount.value = { fakeid: 'account-a' };
  await nextTick();
  assert.deepEqual(reloaded, ['account-a']);

  selectedAccount.value = { fakeid: 'account-b' };
  await nextTick();
  assert.deepEqual(reloaded, ['account-a', 'account-b']);
  stop();
});

test('article table clears when no account is selected', async () => {
  const selectedAccount = ref<{ fakeid: string } | undefined>({ fakeid: 'account-a' });
  const autoSyncingBiz = ref<string | null>(null);
  let unavailableCount = 0;
  const stop = watchArticleTableReloads({
    selectedAccount,
    autoSyncingBiz,
    onAccountUnavailable: () => unavailableCount++,
    onReload() {},
  });

  selectedAccount.value = undefined;
  await nextTick();
  assert.equal(unavailableCount, 1);
  stop();
});

test('article table reloads after the selected account finishes its automatic sync', async () => {
  const selectedAccount = ref<{ fakeid: string } | undefined>({ fakeid: 'account-a' });
  const autoSyncingBiz = ref<string | null>('account-a');
  const reloaded: string[] = [];
  const stop = watchArticleTableReloads({
    selectedAccount,
    autoSyncingBiz,
    onAccountUnavailable() {},
    onReload: fakeid => reloaded.push(fakeid),
  });
  reloaded.length = 0;

  autoSyncingBiz.value = null;
  await nextTick();
  assert.deepEqual(reloaded, ['account-a']);

  autoSyncingBiz.value = 'account-b';
  await nextTick();
  autoSyncingBiz.value = null;
  await nextTick();
  assert.deepEqual(reloaded, ['account-a']);
  stop();
});

test('article table refreshes after every persisted page for the selected account', async () => {
  const selectedAccount = ref<{ fakeid: string } | undefined>({ fakeid: 'account-a' });
  const autoSyncingBiz = ref<string | null>(null);
  const lastSyncedPage = ref<{ fakeid: string; sequence: number } | null>(null);
  const refreshed: string[] = [];
  const stop = watchArticleTableReloads({
    selectedAccount,
    autoSyncingBiz,
    lastSyncedPage,
    onAccountUnavailable() {},
    onReload() {},
    onPageSynced: fakeid => refreshed.push(fakeid),
  });

  lastSyncedPage.value = { fakeid: 'account-a', sequence: 1 };
  await nextTick();
  lastSyncedPage.value = { fakeid: 'account-a', sequence: 2 };
  await nextTick();
  lastSyncedPage.value = { fakeid: 'account-b', sequence: 3 };
  await nextTick();

  assert.deepEqual(refreshed, ['account-a', 'account-a']);
  stop();
});

test('article page delegates table reload watching to the tested watcher', async () => {
  const source = await readFile(new URL('../pages/dashboard/article.vue', import.meta.url), 'utf8');

  assert.match(source, /watchArticleTableReloads\(\{/);
  assert.doesNotMatch(source, /watch\(selectedAccount,/);
});

test('manual article sync publishes each persisted page to the article table', async () => {
  const [syncSource, articleSource] = await Promise.all([
    readFile(new URL('../composables/useAccountArticleSync.ts', import.meta.url), 'utf8'),
    readFile(new URL('../pages/dashboard/article.vue', import.meta.url), 'utf8'),
  ]);
  const requestIndex = syncSource.indexOf('await getArticleList(account, begin)');
  const publishIndex = syncSource.indexOf('lastSyncedPage.value =');

  assert.ok(requestIndex >= 0);
  assert.ok(publishIndex > requestIndex);
  assert.match(syncSource, /lastSyncedPage,/);
  assert.match(articleSource, /lastSyncedPage,/);
  assert.match(articleSource, /onPageSynced\(fakeid\)/);
  assert.match(articleSource, /switchTableData\(fakeid, \{ showLoading: false \}\)/);
});

test('every Lucide icon used by article actions exists in the installed local collection', async () => {
  const [articleSource, selectorSource, packageSource] = await Promise.all([
    readFile(new URL('../pages/dashboard/article.vue', import.meta.url), 'utf8'),
    readFile(new URL('../components/selector/AccountSelectorForArticle.vue', import.meta.url), 'utf8'),
    readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageSource);
  const iconNames = [...`${articleSource}\n${selectorSource}`.matchAll(/i-lucide:([a-z0-9-]+)/g)].map(
    match => match[1]
  );

  assert.ok(packageJson.dependencies?.['@iconify-json/lucide']);
  assert.ok(iconNames.length > 0);
  for (const iconName of iconNames) {
    assert.ok(lucideIcons.icons[iconName], `missing local Lucide icon: ${iconName}`);
  }
});
