interface AccountSyncContinuation {
  completed: boolean;
  loadMore: boolean;
  oldestArticleTimestamp?: number;
  syncToTimestamp: number;
}

interface AccountActionState {
  autoSyncingBiz: string | null;
  manuallySyncing: boolean;
  deleting: boolean;
}

interface CredentialInitialSyncAttempt {
  markAttempt: () => void;
  waitForPersistence: () => Promise<void>;
  sync: () => Promise<void>;
}

interface ManualSyncAttempt {
  sync: () => Promise<void>;
  markInitialized: () => void;
}

interface AsyncMutex {
  runExclusive<T>(task: () => Promise<T>): Promise<T>;
}

export function createAsyncMutex(): AsyncMutex {
  let tail = Promise.resolve();

  return {
    async runExclusive<T>(task: () => Promise<T>): Promise<T> {
      const previous = tail;
      let release: () => void = () => {};
      tail = new Promise<void>(resolve => {
        release = resolve;
      });

      await previous;
      try {
        return await task();
      } finally {
        release();
      }
    },
  };
}

export function createCoalescedSerialRunner(task: () => Promise<void>): () => Promise<void> {
  let activeRun: Promise<void> | null = null;
  let rerunRequested = false;

  return function run() {
    rerunRequested = true;
    if (!activeRun) {
      activeRun = (async () => {
        try {
          while (rerunRequested) {
            rerunRequested = false;
            try {
              await task();
            } catch (error) {
              if (!rerunRequested) throw error;
            }
          }
        } finally {
          activeRun = null;
        }
      })();
    }
    return activeRun;
  };
}

export function isAccountActionLocked({ autoSyncingBiz, manuallySyncing, deleting }: AccountActionState): boolean {
  return autoSyncingBiz !== null || manuallySyncing || deleting;
}

export async function runCredentialInitialSyncAttempt({
  markAttempt,
  waitForPersistence,
  sync,
}: CredentialInitialSyncAttempt): Promise<void> {
  markAttempt();
  await waitForPersistence();
  await sync();
}

export async function runManualSyncAttempt({ sync, markInitialized }: ManualSyncAttempt): Promise<void> {
  await sync();
  markInitialized();
}

export function shouldContinueAccountSync({
  completed,
  loadMore,
  oldestArticleTimestamp,
  syncToTimestamp,
}: AccountSyncContinuation): boolean {
  if (completed || !loadMore) return false;
  if (oldestArticleTimestamp !== undefined && oldestArticleTimestamp < syncToTimestamp) return false;
  return true;
}
