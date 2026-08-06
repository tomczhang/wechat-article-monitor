import type { MpAccount } from '../store/v2/info';

export interface ParsedCredential {
  nickname?: string;
  avatar?: string;
  biz: string;
  uin: string;
  key: string;
  pass_ticket: string;
  wap_sid2: string;
  appmsg_token: string;
  cookie: string;
  timestamp: number;
  time?: string;
  valid: boolean;
  initialized?: boolean;
}

export interface CredentialAccount extends MpAccount {
  nickname: string;
  credential: ParsedCredential;
  credentialValid: boolean;
  credentialTimestamp: number;
}
