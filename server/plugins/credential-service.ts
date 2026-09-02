import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, watch, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import {
  autoEnableSystemProxy,
  detectCredentialUpstream,
  getSafeProxyUrl,
  recoverStaleSystemProxy,
  restoreSystemProxy,
  setCredentialMitmReady,
} from '~/server/utils/system-proxy-manager';

const MITM_PORT = process.env.CREDENTIAL_MITM_PORT || '65000';
const SERVICE_DIR = process.env.CREDENTIAL_SERVICE_DIR
  ? resolve(process.env.CREDENTIAL_SERVICE_DIR)
  : resolve(process.cwd(), 'credential-service');
const CREDENTIAL_PY = join(SERVICE_DIR, 'credential.py');
const LOCAL_MITMDUMP =
  process.platform === 'win32'
    ? join(SERVICE_DIR, '.venv', 'Scripts', 'mitmdump.exe')
    : join(SERVICE_DIR, '.venv', 'bin', 'mitmdump');
const DATA_DIR = process.env.CREDENTIAL_DATA_DIR ? resolve(process.env.CREDENTIAL_DATA_DIR) : join(SERVICE_DIR, 'data');
const CREDENTIALS_JSON = join(DATA_DIR, 'credentials.json');
const CREDENTIAL_LIVE_MS = 30 * 60 * 1000;

interface CredentialServiceRuntime {
  mitmProcess: ChildProcess | null;
  mitmRunning: boolean;
  watchAbortController: AbortController | null;
  broadcastTimer: NodeJS.Timeout | null;
  upstreamProxy: string | null;
  wsClients: Set<any>;
  exitHookBound: boolean;
}

const globalScope = globalThis as typeof globalThis & {
  __credentialServiceRuntime?: CredentialServiceRuntime;
};
const runtime: CredentialServiceRuntime = (globalScope.__credentialServiceRuntime ||= {
  mitmProcess: null,
  mitmRunning: false,
  watchAbortController: null,
  broadcastTimer: null,
  upstreamProxy: null,
  wsClients: new Set<any>(),
  exitHookBound: false,
});

export interface CredentialItem {
  biz?: string;
  name?: string;
  avatar?: string;
  url: string;
  set_cookie: string;
  timestamp: number;
}

export function getCredentialServiceState() {
  return {
    running: runtime.mitmRunning,
    proxyAddress: runtime.mitmRunning ? `http://127.0.0.1:${MITM_PORT}` : null,
    port: Number(MITM_PORT),
    upstreamProxy: getSafeProxyUrl(runtime.upstreamProxy),
  };
}

export function getWsClients() {
  return runtime.wsClients;
}

export async function readCredentials(): Promise<CredentialItem[]> {
  try {
    await access(CREDENTIALS_JSON, constants.R_OK);
    const raw = await readFile(CREDENTIALS_JSON, 'utf-8');
    if (!raw.trim()) return [];
    const data: CredentialItem[] = JSON.parse(raw);
    const cutoff = Date.now() - CREDENTIAL_LIVE_MS;
    return data.filter(item => item.timestamp > cutoff);
  } catch {
    return [];
  }
}

function broadcastCredentials(data: CredentialItem[]) {
  const payload = JSON.stringify(data);
  for (const client of runtime.wsClients) {
    try {
      client.send(payload);
    } catch {
      runtime.wsClients.delete(client);
    }
  }
}

async function startFileWatcher() {
  if (runtime.watchAbortController || runtime.broadcastTimer) return;
  try {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      await access(CREDENTIALS_JSON, constants.F_OK);
    } catch {
      await writeFile(CREDENTIALS_JSON, '[]', 'utf-8');
    }

    runtime.watchAbortController = new AbortController();
    const ac = runtime.watchAbortController;

    (async () => {
      try {
        const watcher = watch(CREDENTIALS_JSON, { signal: ac.signal });
        for await (const event of watcher) {
          if (event.eventType === 'change') {
            const data = await readCredentials();
            broadcastCredentials(data);
          }
        }
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('[credential-service] file watcher error:', err);
        }
      }
    })();

    runtime.broadcastTimer = setInterval(async () => {
      const data = await readCredentials();
      broadcastCredentials(data);
    }, 5000);

    console.log('[credential-service] file watcher started');
  } catch (err) {
    console.error('[credential-service] failed to start file watcher:', err);
  }
}

async function startMitmProxy() {
  if (runtime.mitmProcess) return;
  try {
    await access(CREDENTIAL_PY, constants.R_OK);
  } catch {
    console.warn('[credential-service] credential.py not found, skipping mitmproxy startup');
    return;
  }

  let mitmdumpCommand = 'mitmdump';
  try {
    await access(LOCAL_MITMDUMP, constants.X_OK);
    mitmdumpCommand = LOCAL_MITMDUMP;
  } catch {
    // 未创建项目虚拟环境时，继续尝试使用 PATH 中的全局 mitmdump。
  }

  if (await isMitmPortListening()) {
    console.warn(`[credential-service] port ${MITM_PORT} is already listening; reusing existing mitmproxy endpoint`);
    markMitmReady();
    return;
  }

  const args = [
    '--listen-host',
    '127.0.0.1',
    '-p',
    MITM_PORT,
    '-s',
    CREDENTIAL_PY,
    '--allow-hosts',
    '(^|\\.)mp\\.weixin\\.qq\\.com(?::\\d+)?$',
  ];
  if (runtime.upstreamProxy) {
    args.push('--mode', `upstream:${runtime.upstreamProxy}`);
  }
  args.push('--set', `credentials=${CREDENTIALS_JSON}`, '--set', 'connection_strategy=lazy');

  console.log(`[credential-service] starting mitmdump on port ${MITM_PORT}...`);
  runtime.mitmRunning = false;
  setCredentialMitmReady(false, runtime.upstreamProxy);

  runtime.mitmProcess = spawn(mitmdumpCommand, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: SERVICE_DIR,
    env: {
      ...process.env,
      PYTHONUNBUFFERED: '1',
    },
  });

  const processInstance = runtime.mitmProcess;
  processInstance.once('spawn', () => {
    console.log(`[credential-service] mitmdump process started on port ${MITM_PORT}`);
    startMitmWatchdog(processInstance);
    waitForMitmReady(processInstance);
  });

  processInstance.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      console.log(`[mitmdump] ${line}`);
      if (runtime.mitmProcess === processInstance && /HTTP\(S\) proxy.*listening/.test(line)) {
        markMitmReady();
      }
    }
  });

  processInstance.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      console.error(`[mitmdump] ${line}`);
      if (runtime.mitmProcess === processInstance && /HTTP\(S\) proxy.*listening/.test(line)) {
        markMitmReady();
      }
    }
  });

  processInstance.on('exit', code => {
    if (runtime.mitmProcess === processInstance) {
      runtime.mitmProcess = null;
      runtime.mitmRunning = false;
      setCredentialMitmReady(false, runtime.upstreamProxy);
    }
    console.log(`[credential-service] mitmdump exited with code ${code}`);
  });

  processInstance.on('error', err => {
    if (runtime.mitmProcess === processInstance) {
      runtime.mitmProcess = null;
      runtime.mitmRunning = false;
      setCredentialMitmReady(false, runtime.upstreamProxy);
    }
    console.error('[credential-service] failed to start mitmdump:', err.message);
  });
}

function startMitmWatchdog(processInstance: ChildProcess) {
  if (!processInstance.pid) return;
  const watchdogScript = `
    const parentPid = Number(process.argv[1]);
    const childPid = Number(process.argv[2]);
    const alive = pid => {
      try { process.kill(pid, 0); return true; } catch { return false; }
    };
    const timer = setInterval(() => {
      if (!alive(childPid)) {
        clearInterval(timer);
        process.exit(0);
      }
      if (!alive(parentPid)) {
        try { process.kill(childPid, 'SIGTERM'); } catch {}
        clearInterval(timer);
        process.exit(0);
      }
    }, 500);
  `;
  const watchdog = spawn(process.execPath, ['-e', watchdogScript, String(process.pid), String(processInstance.pid)], {
    detached: true,
    stdio: 'ignore',
  });
  watchdog.unref();
}

function isMitmPortListening(timeoutMs = 300) {
  return new Promise<boolean>(resolvePromise => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(MITM_PORT) });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolvePromise(listening);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

function waitForMitmReady(processInstance: ChildProcess) {
  const startedAt = Date.now();
  const timer = setInterval(async () => {
    if (runtime.mitmProcess !== processInstance || runtime.mitmRunning) {
      clearInterval(timer);
      return;
    }
    if (Date.now() - startedAt > 10_000) {
      clearInterval(timer);
      console.error(`[credential-service] timed out waiting for mitmproxy on port ${MITM_PORT}`);
      return;
    }
    if (await isMitmPortListening(500)) {
      clearInterval(timer);
      markMitmReady();
    }
  }, 500);
}

function markMitmReady() {
  if (runtime.mitmRunning) return;
  runtime.mitmRunning = true;
  setCredentialMitmReady(true, runtime.upstreamProxy);
  console.log(`[credential-service] mitmproxy proxy ready at http://127.0.0.1:${MITM_PORT}`);
  autoEnableSystemProxy();
}

function stopMitmProxy() {
  if (runtime.mitmProcess) {
    runtime.mitmProcess.kill('SIGTERM');
    runtime.mitmProcess = null;
    runtime.mitmRunning = false;
    setCredentialMitmReady(false, runtime.upstreamProxy);
  }
  if (runtime.watchAbortController) {
    runtime.watchAbortController.abort();
    runtime.watchAbortController = null;
  }
  if (runtime.broadcastTimer) {
    clearInterval(runtime.broadcastTimer);
    runtime.broadcastTimer = null;
  }
}

export default defineNitroPlugin(async nitro => {
  if (!runtime.exitHookBound) {
    runtime.exitHookBound = true;
    process.once('exit', stopMitmProxy);
  }

  await recoverStaleSystemProxy();
  try {
    runtime.upstreamProxy = await detectCredentialUpstream();
  } catch (error: any) {
    console.warn(`[credential-service] unable to detect upstream proxy: ${error?.message || error}`);
  }

  await startMitmProxy();
  startFileWatcher();

  nitro.hooks.hook('close', async () => {
    await restoreSystemProxy().catch(error => {
      console.error('[credential-service] failed to restore system proxy:', error);
    });
    stopMitmProxy();
  });
});
