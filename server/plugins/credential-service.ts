import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, watch, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MITM_PORT = process.env.CREDENTIAL_MITM_PORT || '65000';
const SERVICE_DIR = resolve(process.cwd(), 'credential-service');
const CREDENTIAL_PY = join(SERVICE_DIR, 'credential.py');
const LOCAL_MITMDUMP =
  process.platform === 'win32'
    ? join(SERVICE_DIR, '.venv', 'Scripts', 'mitmdump.exe')
    : join(SERVICE_DIR, '.venv', 'bin', 'mitmdump');
const DATA_DIR = join(SERVICE_DIR, 'data');
const CREDENTIALS_JSON = join(DATA_DIR, 'credentials.json');
const CREDENTIAL_LIVE_MS = 30 * 60 * 1000;

let mitmProcess: ChildProcess | null = null;
let mitmRunning = false;
let watchAbortController: AbortController | null = null;
let broadcastTimer: NodeJS.Timeout | null = null;

export interface CredentialItem {
  biz?: string;
  name?: string;
  avatar?: string;
  url: string;
  set_cookie: string;
  timestamp: number;
}

const wsClients = new Set<any>();

export function getCredentialServiceState() {
  return {
    running: mitmRunning,
    proxyAddress: mitmRunning ? `http://127.0.0.1:${MITM_PORT}` : null,
    port: Number(MITM_PORT),
  };
}

export function getWsClients() {
  return wsClients;
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
  for (const client of wsClients) {
    try {
      client.send(payload);
    } catch {
      wsClients.delete(client);
    }
  }
}

async function startFileWatcher() {
  try {
    await mkdir(DATA_DIR, { recursive: true });
    try {
      await access(CREDENTIALS_JSON, constants.F_OK);
    } catch {
      await writeFile(CREDENTIALS_JSON, '[]', 'utf-8');
    }

    watchAbortController = new AbortController();
    const ac = watchAbortController;

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

    broadcastTimer = setInterval(async () => {
      const data = await readCredentials();
      broadcastCredentials(data);
    }, 5000);

    console.log('[credential-service] file watcher started');
  } catch (err) {
    console.error('[credential-service] failed to start file watcher:', err);
  }
}

async function startMitmProxy() {
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

  const args = [
    '-p',
    MITM_PORT,
    '-s',
    CREDENTIAL_PY,
    '--set',
    `credentials=${CREDENTIALS_JSON}`,
    '--set',
    'connection_strategy=lazy',
  ];

  console.log(`[credential-service] starting mitmdump on port ${MITM_PORT}...`);

  mitmProcess = spawn(mitmdumpCommand, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: SERVICE_DIR,
  });

  mitmProcess.once('spawn', () => {
    mitmRunning = true;
    console.log(`[credential-service] mitmdump process started on port ${MITM_PORT}`);
  });

  mitmProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      console.log(`[mitmdump] ${line}`);
      if (line.includes('HTTP(S) proxy listening')) {
        mitmRunning = true;
        console.log(`[credential-service] mitmproxy proxy ready at http://127.0.0.1:${MITM_PORT}`);
      }
    }
  });

  mitmProcess.stderr?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      console.error(`[mitmdump] ${line}`);
    }
  });

  mitmProcess.on('exit', code => {
    mitmRunning = false;
    console.log(`[credential-service] mitmdump exited with code ${code}`);
  });

  mitmProcess.on('error', err => {
    mitmRunning = false;
    console.error('[credential-service] failed to start mitmdump:', err.message);
  });
}

function stopMitmProxy() {
  if (mitmProcess) {
    mitmProcess.kill('SIGTERM');
    mitmProcess = null;
    mitmRunning = false;
  }
  if (watchAbortController) {
    watchAbortController.abort();
    watchAbortController = null;
  }
  if (broadcastTimer) {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
}

export default defineNitroPlugin(nitro => {
  startMitmProxy();
  startFileWatcher();

  nitro.hooks.hook('close', () => {
    stopMitmProxy();
  });
});
