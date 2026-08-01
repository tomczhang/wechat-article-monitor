import { getCredentialServiceState, readCredentials } from '~/server/plugins/credential-service';
import { getSystemProxyStatus, isLoopbackRequest } from '~/server/utils/system-proxy-manager';

export default defineEventHandler(async event => {
  const state = getCredentialServiceState();
  const [credentials, systemProxy] = await Promise.all([
    readCredentials(),
    getSystemProxyStatus({ includeConfirmationToken: isLoopbackRequest(event) }),
  ]);

  return {
    ...state,
    credentialCount: credentials.length,
    systemProxy,
  };
});
