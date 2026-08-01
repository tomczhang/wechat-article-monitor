import { assertSystemProxyRequest, enableSystemProxy, getSystemProxyStatus } from '~/server/utils/system-proxy-manager';

export default defineEventHandler(async event => {
  assertSystemProxyRequest(event);
  await enableSystemProxy({ rememberConsent: true });
  return getSystemProxyStatus();
});
