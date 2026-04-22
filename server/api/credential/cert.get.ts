import { constants } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { isRemoteMode, MITM_CA_CERT_PATH } from '~/server/plugins/credential-service';

/**
 * 自服务下载 mitmproxy CA 证书。
 *
 * - 仅在远程模式下开放（本地模式返回 404，避免误用）
 * - 不要求任何 auth：方便手机扫码下载
 * - `?fmt=pem|crt` 控制返回扩展名（iOS 装描述文件需要 .pem，Android 通常用 .crt）
 */
export default defineEventHandler(async event => {
  if (!isRemoteMode()) {
    setResponseStatus(event, 404);
    return 'Not Found: credential service is in local mode';
  }

  try {
    await access(MITM_CA_CERT_PATH, constants.R_OK);
  } catch {
    setResponseStatus(event, 503);
    return 'mitmproxy CA cert not ready yet, please try again in a few seconds';
  }

  const query = getQuery(event);
  const fmt = (query.fmt === 'crt' ? 'crt' : 'pem') as 'pem' | 'crt';
  const data = await readFile(MITM_CA_CERT_PATH, 'utf-8');

  setHeader(event, 'Content-Type', 'application/x-x509-ca-cert');
  setHeader(event, 'Content-Disposition', `attachment; filename="mitmproxy-ca-cert.${fmt}"`);
  setHeader(event, 'Cache-Control', 'no-store');
  return data;
});
