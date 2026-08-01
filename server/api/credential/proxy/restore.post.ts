import {
  assertSystemProxyRequest,
  getSystemProxyStatus,
  restoreSystemProxy,
} from '~/server/utils/system-proxy-manager';

export default defineEventHandler(async event => {
  assertSystemProxyRequest(event);
  await restoreSystemProxy({ clearConsent: true });
  return getSystemProxyStatus();
});
