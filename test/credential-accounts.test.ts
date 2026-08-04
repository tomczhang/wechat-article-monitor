import assert from 'node:assert/strict';
import test from 'node:test';
import type { MpAccount } from '../store/v2/info.ts';
import type { ParsedCredential } from '../types/credential.d.ts';
import {
  buildCredentialAccounts,
  createCredentialAccountSeed,
  mergeCredentialHistory,
  shouldAutoSyncCredential,
  sortCredentialAccounts,
} from '../utils/credential-accounts.ts';

function credential(biz: string, timestamp: number, overrides: Partial<ParsedCredential> = {}): ParsedCredential {
  return {
    biz,
    uin: 'uin',
    key: 'key',
    pass_ticket: 'ticket',
    wap_sid2: 'sid',
    appmsg_token: 'token',
    cookie: 'cookie',
    timestamp,
    valid: true,
    ...overrides,
  };
}

function account(fakeid: string, overrides: Partial<MpAccount> = {}): MpAccount {
  return {
    fakeid,
    completed: false,
    count: 0,
    articles: 0,
    total_count: 0,
    ...overrides,
  };
}

test('mergeCredentialHistory preserves accounts missing from the latest broadcast', () => {
  const result = mergeCredentialHistory(
    [credential('old', 10, { nickname: '旧账号' })],
    [credential('new', 30, { nickname: '新账号' })]
  );

  assert.deepEqual(
    result.map(item => item.biz),
    ['new', 'old']
  );
});

test('mergeCredentialHistory keeps the latest credential and its non-empty identity', () => {
  const result = mergeCredentialHistory(
    [credential('same', 30, { key: 'latest', nickname: '保留名称', avatar: 'new.png' })],
    [credential('same', 20, { key: 'stale', nickname: '旧名称', avatar: 'old.png' })]
  );

  assert.equal(result[0].key, 'latest');
  assert.equal(result[0].nickname, '保留名称');
  assert.equal(result[0].avatar, 'new.png');
});

test('mergeCredentialHistory fills missing identity without downgrading credential fields', () => {
  const result = mergeCredentialHistory(
    [credential('same', 30, { key: 'latest' })],
    [credential('same', 20, { key: 'stale', nickname: '补齐名称', avatar: 'avatar.png' })]
  );

  assert.equal(result[0].key, 'latest');
  assert.equal(result[0].nickname, '补齐名称');
  assert.equal(result[0].avatar, 'avatar.png');
});

test('mergeCredentialHistory preserves the completed initial-sync marker', () => {
  const result = mergeCredentialHistory([credential('same', 20, { initialized: true })], [credential('same', 30)]);

  assert.equal(result[0].initialized, true);
});

test('buildCredentialAccounts only returns credential-backed accounts and keeps expired cached accounts', () => {
  const result = buildCredentialAccounts(
    [credential('active', 100, { nickname: '有效账号', valid: true }), credential('expired', 50, { valid: false })],
    [
      account('active', { nickname: '缓存名称', articles: 12, total_count: 12 }),
      account('expired', { nickname: '过期账号', articles: 87, total_count: 87 }),
      account('imported', { nickname: '仅导入账号', articles: 26, total_count: 26 }),
    ]
  );

  assert.deepEqual(
    result.map(item => item.fakeid),
    ['active', 'expired']
  );
  assert.equal(result[0].nickname, '有效账号');
  assert.equal(result[0].articles, 12);
  assert.equal(result[0].credentialValid, true);
  assert.equal(result[1].nickname, '过期账号');
  assert.equal(result[1].articles, 87);
  assert.equal(result[1].credentialValid, false);
});

test('createCredentialAccountSeed uses the captured name and biz fallback', () => {
  assert.equal(createCredentialAccountSeed(credential('named', 10, { nickname: '公众号名称' })).nickname, '公众号名称');
  assert.equal(
    createCredentialAccountSeed(credential('cached-name', 10), account('cached-name', { nickname: '缓存公众号名称' }))
      .nickname,
    '缓存公众号名称'
  );
  assert.equal(createCredentialAccountSeed(credential('fallback', 10)).nickname, 'fallback');
});

test('shouldAutoSyncCredential runs once for every newly captured valid account, even with old cache', () => {
  assert.equal(shouldAutoSyncCredential(credential('new', 10)), true);
  assert.equal(shouldAutoSyncCredential(credential('cached', 10), account('cached')), true);
  assert.equal(shouldAutoSyncCredential(credential('expired', 10, { valid: false })), false);
  assert.equal(shouldAutoSyncCredential(credential('initialized', 10, { initialized: true })), false);
});

test('sortCredentialAccounts puts valid and recently captured accounts first', () => {
  const accounts = buildCredentialAccounts(
    [
      credential('expired-newer', 300, { valid: false }),
      credential('valid-older', 100, { valid: true }),
      credential('valid-newer', 200, { valid: true }),
    ],
    []
  );

  assert.deepEqual(
    sortCredentialAccounts(accounts).map(item => item.fakeid),
    ['valid-newer', 'valid-older', 'expired-newer']
  );
});
