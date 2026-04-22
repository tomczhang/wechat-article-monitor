import { type ChildProcess, spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, readFile, watch, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const MITM_PORT = process.env.CREDENTIAL_MITM_PORT || '65000';
const MITM_LISTEN_HOST = process.env.MITM_LISTEN_HOST || '127.0.0.1';
const MITM_PROXY_AUTH = process.env.MITM_PROXY_AUTH || '';
const PUBLIC_HOST = process.env.CREDENTIAL_PUBLIC_HOST || '';
const SERVICE_DIR = resolve(process.cwd(), 'credential-service');
const CREDENTIAL_PY = join(SERVICE_DIR, 'credential.py');
const DATA_DIR = join(SERVICE_DIR, 'data');
const CREDENTIALS_JSON = join(DATA_DIR, 'credentials.json');
const CREDENTIAL_LIVE_MS = 30 * 60 * 1000;

/** mitm CA 证书路径，由 mitmproxy 首次启动后写入 */
export const MITM_CA_CERT_PATH = join(
  process.env.HOME || '/root',
  '.mitmproxy',
  'mitmproxy-ca-cert.pem'
);

/** 远程模式：监听非 127.0.0.1，通常配合 PUBLIC_HOST 暴露给手机 */
export function isRemoteMode(): boolean {
  return MITM_LISTEN_HOST !== '127.0.0.1' && MITM_LISTEN_HOST !== 'localhost';
}

let mitmProcess: ChildProcess | null = null;
let mitmRunning = false;
let watcher: AsyncIterable<any> | null = null;
let watchAbortController: AbortController | null = null;

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
  const remote = isRemoteMode();
  const port = Number(MITM_PORT);
  return {
    running: mitmRunning,
    mode: remote ? ('remote' as const) : ('local' as const),
    port,
    publicHost: remote ? PUBLIC_HOST : null,
    proxyAddress: mitmRunning
      ? remote && PUBLIC_HOST
        ? `${PUBLIC_HOST}:${port}`
        : `http://127.0.0.1:${port}`
      : null,
    proxyAuthEnabled: remote && Boolean(MITM_PROXY_AUTH),
    certUrl: remote ? '/api/credential/cert' : null,
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

    setInterval(async () => {
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

  const remote = isRemoteMode();
  if (remote && !MITM_PROXY_AUTH) {
    console.error(
      '[credential-service] FATAL: MITM_LISTEN_HOST is non-loopback but MITM_PROXY_AUTH is empty; refusing to expose an open proxy. Set MITM_PROXY_AUTH=user:pass and restart.'
    );
    process.exit(1);
  }

  const args = [
    '--listen-host',
    MITM_LISTEN_HOST,
    '-p',
    MITM_PORT,
    '-s',
    CREDENTIAL_PY,
    '--set',
    `credentials=${CREDENTIALS_JSON}`,
    '--set',
    'connection_strategy=lazy',
  ];

  if (MITM_PROXY_AUTH) {
    args.push('--proxyauth', MITM_PROXY_AUTH);
  }

  console.log(
    `[credential-service] starting mitmdump on ${MITM_LISTEN_HOST}:${MITM_PORT} (${remote ? 'remote' : 'local'} mode${MITM_PROXY_AUTH ? ', proxyauth enabled' : ''})...`
  );

  mitmProcess = spawn('mitmdump', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: SERVICE_DIR,
  });

  mitmProcess.stdout?.on('data', (chunk: Buffer) => {
    const line = chunk.toString().trim();
    if (line) {
      console.log(`[mitmdump] ${line}`);
      if (line.includes('HTTP(S) proxy listening')) {
        mitmRunning = true;
        console.log(
          `[credential-service] mitmproxy proxy ready at ${MITM_LISTEN_HOST}:${MITM_PORT}`
        );
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
}

export default defineNitroPlugin(nitro => {
  startMitmProxy();
  startFileWatcher();

  nitro.hooks.hook('close', () => {
    stopMitmProxy();
  });
});
