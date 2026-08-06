import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('monitor header selects an addable Credential inline', async () => {
  const source = await readFile(new URL('../pages/dashboard/monitor.vue', import.meta.url), 'utf8');

  assert.match(source, /v-model="selectedCredentialToAdd"/);
  assert.match(source, /:options="addableCredentials"/);
  assert.match(source, /@update:model-value="onCredentialSelected"/);
  assert.match(source, /<span v-else[^>]*>[\s\S]*选择 Credential 加入监控/);
  assert.doesNotMatch(source, /showCredentialPicker/);
  assert.doesNotMatch(source, /添加监控公众号/);
});

test('global actions only link to this project on GitHub', async () => {
  const source = await readFile(new URL('../components/dashboard/Actions.vue', import.meta.url), 'utf8');

  assert.match(source, /https:\/\/github\.com\/tomczhang\/wechat-article-monitor/);
  assert.doesNotMatch(source, /QQGroupModal|加入QQ群|docsWebSite|打开文档/);
  assert.doesNotMatch(source, /github\.com\/wechat-article\/wechat-article-exporter/);
});
