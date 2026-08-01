import useCredentials from '~/composables/useCredentials';

export type CredentialGateState = 'checking' | 'needsConsent' | 'configuring' | 'waitingCredential' | 'ready' | 'error';

interface CredentialRequiredDetail {
  fakeid?: string;
  reason?: string;
}

let initialized = false;
let eventBound = false;
const waiters: Array<{ fakeid?: string; resolve: (ready: boolean) => void }> = [];

export default function useCredentialGate() {
  const { validCredentials, serviceStatus, statusReady, statusError, wsConnected, start, refreshServiceStatus } =
    useCredentials();

  const open = useState<boolean>('credential-gate-open', () => false);
  const sessionPassed = useState<boolean>('credential-gate-passed', () => false);
  const targetBiz = useState<string | null>('credential-gate-target-biz', () => null);
  const reason = useState<string>('credential-gate-reason', () => '');
  const configuring = useState<boolean>('credential-gate-configuring', () => false);
  const actionError = useState<string | null>('credential-gate-action-error', () => null);
  const openedAt = useState<number>('credential-gate-opened-at', () => 0);

  const targetCredentialReady = computed(() => {
    if (targetBiz.value) return validCredentials.value.some(item => item.biz === targetBiz.value);
    return validCredentials.value.length > 0;
  });

  const state = computed<CredentialGateState>(() => {
    if (configuring.value) return 'configuring';
    if (!statusReady.value) return 'checking';
    if (statusError.value || actionError.value || !serviceStatus.value.running) return 'error';
    if (targetCredentialReady.value && !open.value) return 'ready';
    if (!serviceStatus.value.systemProxy?.managed) return 'needsConsent';
    return 'waitingCredential';
  });

  const canClose = computed(() => sessionPassed.value);

  function openGate(options: CredentialRequiredDetail & { refresh?: boolean } = {}) {
    targetBiz.value = options.fakeid || null;
    reason.value = options.reason || '';
    actionError.value = null;
    openedAt.value = options.refresh ? Date.now() : 0;
    open.value = true;
  }

  function closeGate() {
    if (!canClose.value) return;
    open.value = false;
    targetBiz.value = null;
    reason.value = '';
    waiters.splice(0).forEach(waiter => waiter.resolve(false));
  }

  function requireCredential(fakeid?: string): Promise<boolean> {
    const ready = fakeid ? validCredentials.value.some(item => item.biz === fakeid) : validCredentials.value.length > 0;
    if (ready) return Promise.resolve(true);

    openGate({ fakeid });
    return new Promise(resolvePromise => {
      waiters.push({ fakeid, resolve: resolvePromise });
    });
  }

  async function enableProxy() {
    const token = serviceStatus.value.systemProxy?.confirmationToken;
    if (!token) {
      actionError.value = '未获取到系统代理确认令牌，请刷新状态后重试';
      return;
    }

    configuring.value = true;
    actionError.value = null;
    try {
      await $fetch('/api/credential/proxy/enable', {
        method: 'POST',
        body: {},
        headers: {
          'x-credential-proxy-token': token,
        },
      });
      await refreshServiceStatus();
    } catch (error: any) {
      actionError.value = error?.data?.statusMessage || error?.message || '系统代理配置失败';
      await refreshServiceStatus();
    } finally {
      configuring.value = false;
    }
  }

  async function restoreProxy() {
    const token = serviceStatus.value.systemProxy?.confirmationToken;
    if (!token) return;
    configuring.value = true;
    try {
      await $fetch('/api/credential/proxy/restore', {
        method: 'POST',
        body: {},
        headers: {
          'x-credential-proxy-token': token,
        },
      });
      await refreshServiceStatus();
    } finally {
      configuring.value = false;
    }
  }

  function initialize() {
    start();
    if (!initialized) {
      initialized = true;
      watch(
        [statusReady, validCredentials],
        () => {
          if (!statusReady.value) return;

          if (!sessionPassed.value) {
            if (validCredentials.value.length > 0) {
              sessionPassed.value = true;
              open.value = false;
            } else {
              open.value = true;
            }
            return;
          }

          if (!open.value) return;
          const refreshed =
            openedAt.value > 0 &&
            validCredentials.value.some(
              item => item.timestamp > openedAt.value && (!targetBiz.value || item.biz === targetBiz.value)
            );
          const ready = openedAt.value > 0 ? refreshed : targetCredentialReady.value;
          if (ready) {
            open.value = false;
            targetBiz.value = null;
            reason.value = '';
          }
          for (let index = waiters.length - 1; index >= 0; index--) {
            const waiter = waiters[index];
            const ready = waiter.fakeid
              ? validCredentials.value.some(item => item.biz === waiter.fakeid)
              : validCredentials.value.length > 0;
            if (ready) {
              waiters.splice(index, 1);
              waiter.resolve(true);
            }
          }
        },
        { deep: true, immediate: true }
      );
    }

    if (!eventBound && import.meta.client) {
      eventBound = true;
      window.addEventListener('credential-required', event => {
        const detail = (event as CustomEvent<CredentialRequiredDetail>).detail || {};
        openGate({ ...detail, refresh: true });
      });
    }
  }

  return {
    open,
    sessionPassed,
    targetBiz,
    reason,
    state,
    canClose,
    configuring,
    actionError,
    serviceStatus,
    statusReady,
    statusError,
    wsConnected,
    validCredentials,
    initialize,
    openGate,
    requireCredential,
    closeGate,
    enableProxy,
    restoreProxy,
    refreshServiceStatus,
  };
}
