import type { MpAccount } from '../store/v2/info';
import type { CredentialAccount, ParsedCredential } from '../types/credential';

export function mergeCredentialHistory(existing: ParsedCredential[], incoming: ParsedCredential[]): ParsedCredential[] {
  const byBiz = new Map(existing.map(item => [item.biz, { ...item }]));

  for (const next of incoming) {
    const previous = byBiz.get(next.biz);
    if (!previous) {
      byBiz.set(next.biz, { ...next });
      continue;
    }

    const latest = next.timestamp >= previous.timestamp ? next : previous;
    const older = latest === next ? previous : next;
    byBiz.set(next.biz, {
      ...latest,
      nickname: latest.nickname || older.nickname,
      avatar: latest.avatar || older.avatar,
      initialized: latest.initialized || older.initialized,
    });
  }

  return [...byBiz.values()].sort((a, b) => b.timestamp - a.timestamp);
}

export function createCredentialAccountSeed(credential: ParsedCredential, info?: MpAccount): MpAccount {
  return {
    fakeid: credential.biz,
    completed: info?.completed || false,
    count: info?.count || 0,
    articles: info?.articles || 0,
    total_count: info?.total_count || 0,
    ...info,
    nickname: credential.nickname || info?.nickname || credential.biz,
    round_head_img: credential.avatar || info?.round_head_img,
  };
}

export function buildCredentialAccounts(credentials: ParsedCredential[], infos: MpAccount[]): CredentialAccount[] {
  const infoByBiz = new Map(infos.map(info => [info.fakeid, info]));

  return credentials.map(credential => {
    const info = infoByBiz.get(credential.biz);
    return {
      ...createCredentialAccountSeed(credential, info),
      nickname: credential.nickname || info?.nickname || credential.biz,
      round_head_img: credential.avatar || info?.round_head_img,
      credential,
      credentialValid: credential.valid,
      credentialTimestamp: credential.timestamp,
    };
  });
}

export function shouldAutoSyncCredential(credential: ParsedCredential, _info?: MpAccount): boolean {
  return credential.valid && !credential.initialized;
}

export function sortCredentialAccounts(accounts: CredentialAccount[]): CredentialAccount[] {
  return [...accounts].sort(
    (a, b) => Number(b.credentialValid) - Number(a.credentialValid) || b.credentialTimestamp - a.credentialTimestamp
  );
}
