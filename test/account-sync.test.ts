import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createAsyncMutex,
  createCoalescedSerialRunner,
  isAccountActionLocked,
  runCredentialInitialSyncAttempt,
  runManualSyncAttempt,
  shouldContinueAccountSync,
} from '../utils/account-sync.ts';

test('stops when WeChat reports that all pages are complete', () => {
  assert.equal(
    shouldContinueAccountSync({ completed: true, loadMore: true, oldestArticleTimestamp: 200, syncToTimestamp: 100 }),
    false
  );
});

test('stops after one page when loadMore is disabled', () => {
  assert.equal(
    shouldContinueAccountSync({ completed: false, loadMore: false, oldestArticleTimestamp: 200, syncToTimestamp: 100 }),
    false
  );
});

test('stops after reaching the configured synchronization deadline', () => {
  assert.equal(
    shouldContinueAccountSync({ completed: false, loadMore: true, oldestArticleTimestamp: 90, syncToTimestamp: 100 }),
    false
  );
});

test('continues while more pages and configured time remain', () => {
  assert.equal(
    shouldContinueAccountSync({ completed: false, loadMore: true, oldestArticleTimestamp: 200, syncToTimestamp: 100 }),
    true
  );
});

test('coalesces overlapping reconciliation requests without running tasks concurrently', async () => {
  let releaseFirstRun: (() => void) | undefined;
  const firstRunBlocked = new Promise<void>(resolve => {
    releaseFirstRun = resolve;
  });
  let runCount = 0;
  let activeCount = 0;
  let maxActiveCount = 0;

  const run = createCoalescedSerialRunner(async () => {
    runCount++;
    activeCount++;
    maxActiveCount = Math.max(maxActiveCount, activeCount);
    try {
      if (runCount === 1) await firstRunBlocked;
    } finally {
      activeCount--;
    }
  });

  const first = run();
  const second = run();
  const third = run();
  assert.equal(runCount, 1);

  releaseFirstRun?.();
  await Promise.all([first, second, third]);

  assert.equal(runCount, 2);
  assert.equal(maxActiveCount, 1);
});

test('allows reconciliation to run again after a failed task', async () => {
  let runCount = 0;
  const run = createCoalescedSerialRunner(async () => {
    runCount++;
    if (runCount === 1) throw new Error('temporary failure');
  });

  await assert.rejects(run(), /temporary failure/);
  await run();

  assert.equal(runCount, 2);
});

test('executes an overlapping reconciliation request after the active task fails', async () => {
  let releaseFirstRun: (() => void) | undefined;
  const firstRunBlocked = new Promise<void>(resolve => {
    releaseFirstRun = resolve;
  });
  let runCount = 0;
  const run = createCoalescedSerialRunner(async () => {
    runCount++;
    if (runCount === 1) {
      await firstRunBlocked;
      throw new Error('temporary failure');
    }
  });

  const first = run();
  const overlapping = run();
  releaseFirstRun?.();
  await Promise.all([first, overlapping]);

  assert.equal(runCount, 2);
});

test('locks account actions during automatic sync, manual sync, or deletion', () => {
  assert.equal(isAccountActionLocked({ autoSyncingBiz: 'biz-a', manuallySyncing: false, deleting: false }), true);
  assert.equal(isAccountActionLocked({ autoSyncingBiz: null, manuallySyncing: true, deleting: false }), true);
  assert.equal(isAccountActionLocked({ autoSyncingBiz: null, manuallySyncing: false, deleting: true }), true);
  assert.equal(isAccountActionLocked({ autoSyncingBiz: null, manuallySyncing: false, deleting: false }), false);
});

test('persists the initial-sync attempt before requesting articles, including failed requests', async () => {
  const events: string[] = [];
  let initialized = false;

  await assert.rejects(
    runCredentialInitialSyncAttempt({
      markAttempt() {
        initialized = true;
        events.push('mark');
      },
      async waitForPersistence() {
        events.push('persist');
      },
      async sync() {
        events.push('sync');
        throw new Error('network unavailable');
      },
    }),
    /network unavailable/
  );

  assert.equal(initialized, true);
  assert.deepEqual(events, ['mark', 'persist', 'sync']);
});

test('runs automatic sync, manual sync, and deletion tasks through one serial mutex', async () => {
  const mutex = createAsyncMutex();
  const events: string[] = [];
  let releaseFirstTask: (() => void) | undefined;
  const firstTaskBlocked = new Promise<void>(resolve => {
    releaseFirstTask = resolve;
  });

  const first = mutex.runExclusive(async () => {
    events.push('auto:start');
    await firstTaskBlocked;
    events.push('auto:end');
  });
  const second = mutex.runExclusive(async () => {
    events.push('delete:start');
    events.push('delete:end');
  });

  await Promise.resolve();
  assert.deepEqual(events, ['auto:start']);
  releaseFirstTask?.();
  await Promise.all([first, second]);

  assert.deepEqual(events, ['auto:start', 'auto:end', 'delete:start', 'delete:end']);
});

test('releases the shared mutex after an operation fails', async () => {
  const mutex = createAsyncMutex();
  await assert.rejects(
    mutex.runExclusive(async () => {
      throw new Error('sync failed');
    }),
    /sync failed/
  );

  const result = await mutex.runExclusive(async () => 'delete completed');
  assert.equal(result, 'delete completed');
});

test('marks manual sync initialized before a queued automatic sync can recheck it', async () => {
  const mutex = createAsyncMutex();
  let initialized = false;
  let automaticSyncCount = 0;
  let releaseManualSync: (() => void) | undefined;
  const manualSyncBlocked = new Promise<void>(resolve => {
    releaseManualSync = resolve;
  });

  const manual = mutex.runExclusive(() =>
    runManualSyncAttempt({
      async sync() {
        await manualSyncBlocked;
      },
      markInitialized() {
        initialized = true;
      },
    })
  );
  const automatic = mutex.runExclusive(async () => {
    if (!initialized) automaticSyncCount++;
  });

  releaseManualSync?.();
  await Promise.all([manual, automatic]);

  assert.equal(initialized, true);
  assert.equal(automaticSyncCount, 0);
});
