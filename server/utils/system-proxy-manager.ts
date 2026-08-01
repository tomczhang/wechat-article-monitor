import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createError, getRequestHeader, getRequestURL, type H3Event } from 'h3';

const execFileAsync = promisify(execFile);
const NETWORK_SETUP = '/usr/sbin/networksetup';
const ROUTE = '/sbin/route';
const STATE_FILE = join(resolve(process.cwd(), 'credential-service', 'data'), 'system-proxy-state.json');
const MITM_PORT = Number(process.env.CREDENTIAL_MITM_PORT || 65000);
const confirmationToken = randomUUID();

interface ProxyEndpoint {
  enabled: boolean;
  server: string;
  port: number;
  authenticated: boolean;
}

interface AutoProxy {
  enabled: boolean;
  url: string;
}

interface SystemProxySnapshot {
  service: string;
  web: ProxyEndpoint;
  secure: ProxyEndpoint;
  auto: AutoProxy;
}

interface StoredProxyState {
  consent: boolean;
  managed: boolean;
  phase: 'applying' | 'managed' | null;
  upstreamProxy: string | null;
  snapshot: SystemProxySnapshot | null;
}

export interface SystemProxyStatus {
  supported: boolean;
  managed: boolean;
  consent: boolean;
  networkService: string | null;
  upstreamProxy: string | null;
  mitmProxy: string;
  confirmationToken: string | null;
  error: string | null;
}

const DEFAULT_STATE: StoredProxyState = {
  consent: false,
  managed: false,
  phase: null,
  upstreamProxy: null,
  snapshot: null,
};

let operation: Promise<void> | null = null;
let lastError: string | null = null;
const proxyRuntimeScope = globalThis as typeof globalThis & {
  __credentialMitmRuntime?: { ready: boolean; upstreamProxy: string | null };
};
const mitmRuntime = (proxyRuntimeScope.__credentialMitmRuntime ||= {
  ready: false,
  upstreamProxy: null,
});

async function run(executable: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync(executable, args, { encoding: 'utf-8' });
  return stdout.trim();
}

function parseEnabled(value: string | undefined) {
  return value?.trim().toLowerCase() === 'yes';
}

function parseFields(output: string): Record<string, string> {
  return Object.fromEntries(
    output
      .split('\n')
      .map(line => line.match(/^([^:]+):\s*(.*)$/))
      .filter((match): match is RegExpMatchArray => Boolean(match))
      .map(match => [match[1].trim(), match[2].trim()])
  );
}

async function readEndpoint(service: string, kind: 'web' | 'secure'): Promise<ProxyEndpoint> {
  const command = kind === 'web' ? '-getwebproxy' : '-getsecurewebproxy';
  const fields = parseFields(await run(NETWORK_SETUP, [command, service]));
  return {
    enabled: parseEnabled(fields.Enabled),
    server: fields.Server === '(null)' ? '' : fields.Server || '',
    port: Number(fields.Port || 0),
    authenticated: fields['Authenticated Proxy Enabled'] === '1',
  };
}

async function readAutoProxy(service: string): Promise<AutoProxy> {
  const fields = parseFields(await run(NETWORK_SETUP, ['-getautoproxyurl', service]));
  return {
    enabled: parseEnabled(fields.Enabled),
    url: fields.URL === '(null)' ? '' : fields.URL || '',
  };
}

async function getActiveNetworkService(): Promise<string> {
  const routeOutput = await run(ROUTE, ['-n', 'get', 'default']);
  const device = routeOutput.match(/^\s*interface:\s*(\S+)/m)?.[1];
  if (!device) throw new Error('无法识别当前默认网络接口');

  const orderOutput = await run(NETWORK_SETUP, ['-listnetworkserviceorder']);
  const blocks = orderOutput.split(/\n(?=\(\d+\)\s)/);
  for (const block of blocks) {
    const service = block.match(/^\(\d+\)\s+(.+)$/m)?.[1]?.trim();
    const blockDevice = block.match(/Device:\s*([^)]+)/)?.[1]?.trim();
    if (service && blockDevice === device) return service;
  }
  throw new Error(`未找到网络接口 ${device} 对应的网络服务`);
}

async function captureSnapshot(): Promise<SystemProxySnapshot> {
  const service = await getActiveNetworkService();
  const [web, secure, auto] = await Promise.all([
    readEndpoint(service, 'web'),
    readEndpoint(service, 'secure'),
    readAutoProxy(service),
  ]);
  return { service, web, secure, auto };
}

async function readState(): Promise<StoredProxyState> {
  try {
    return { ...DEFAULT_STATE, ...JSON.parse(await readFile(STATE_FILE, 'utf-8')) };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: StoredProxyState) {
  await mkdir(resolve(process.cwd(), 'credential-service', 'data'), { recursive: true });
  const temporaryFile = `${STATE_FILE}.${process.pid}.tmp`;
  await writeFile(temporaryFile, JSON.stringify(state, null, 2), 'utf-8');
  await rename(temporaryFile, STATE_FILE);
}

function endpointUrl(endpoint: ProxyEndpoint): string | null {
  if (!endpoint.enabled || !endpoint.server || !endpoint.port) return null;
  return `http://${endpoint.server}:${endpoint.port}`;
}

export function getSafeProxyUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeProxyUrl(value: string | null): string | null {
  if (!value) return null;
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`不支持的上游代理协议：${url.protocol}`);
  if (url.username || url.password) throw new Error('上游代理 URL 不允许包含认证信息');
  return url.toString().replace(/\/$/, '');
}

function isCredentialMitmEndpoint(value: string | null) {
  if (!value) return false;
  const url = new URL(value);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  const loopback = hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname);
  return loopback && port === MITM_PORT;
}

export function setCredentialMitmReady(ready: boolean, upstreamProxy: string | null) {
  mitmRuntime.ready = ready;
  mitmRuntime.upstreamProxy = upstreamProxy ? normalizeProxyUrl(upstreamProxy) : null;
}

function resolveUpstream(snapshot: SystemProxySnapshot): string | null {
  const configured = process.env.CREDENTIAL_UPSTREAM_PROXY?.trim();
  if (configured) return configured;
  if (snapshot.auto.enabled) {
    throw new Error('当前启用了 PAC 自动代理，请先通过 CREDENTIAL_UPSTREAM_PROXY 明确指定 Clash 上游');
  }
  if (snapshot.web.authenticated || snapshot.secure.authenticated) {
    throw new Error('当前系统代理需要认证，无法在不读取密码的情况下安全托管');
  }

  const web = endpointUrl(snapshot.web);
  const secure = endpointUrl(snapshot.secure);
  if (web && secure && web === secure) return web;
  if (!web && !secure) return null;
  throw new Error('当前 HTTP 与 HTTPS 系统代理不一致，无法安全串联上游代理');
}

async function checkPort(url: string, label: string) {
  const parsed = new URL(url);
  const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
  await new Promise<void>((resolvePromise, reject) => {
    const socket = createConnection({ host: parsed.hostname, port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`${label} ${parsed.hostname}:${port} 连接超时`));
    }, 1500);
    socket.once('connect', () => {
      clearTimeout(timer);
      socket.destroy();
      resolvePromise();
    });
    socket.once('error', error => {
      clearTimeout(timer);
      reject(new Error(`${label}不可用：${error.message}`));
    });
  });
}

async function setEndpoint(service: string, kind: 'web' | 'secure', endpoint: ProxyEndpoint) {
  const prefix = kind === 'web' ? 'webproxy' : 'securewebproxy';
  if (endpoint.server && endpoint.port) {
    await run(NETWORK_SETUP, [`-set${prefix}`, service, endpoint.server, String(endpoint.port)]);
  }
  await run(NETWORK_SETUP, [`-set${prefix}state`, service, endpoint.enabled ? 'on' : 'off']);
}

async function applySnapshot(snapshot: SystemProxySnapshot) {
  await setEndpoint(snapshot.service, 'web', snapshot.web);
  await setEndpoint(snapshot.service, 'secure', snapshot.secure);
  if (snapshot.auto.url) {
    await run(NETWORK_SETUP, ['-setautoproxyurl', snapshot.service, snapshot.auto.url]);
  }
  await run(NETWORK_SETUP, ['-setautoproxystate', snapshot.service, snapshot.auto.enabled ? 'on' : 'off']);
}

async function applyMitmProxy(snapshot: SystemProxySnapshot) {
  await run(NETWORK_SETUP, ['-setautoproxystate', snapshot.service, 'off']);
  const endpoint: ProxyEndpoint = { enabled: true, server: '127.0.0.1', port: MITM_PORT, authenticated: false };
  await setEndpoint(snapshot.service, 'web', endpoint);
  await setEndpoint(snapshot.service, 'secure', endpoint);
}

async function restoreManagedSnapshot(snapshot: SystemProxySnapshot) {
  const [web, secure, auto] = await Promise.all([
    readEndpoint(snapshot.service, 'web'),
    readEndpoint(snapshot.service, 'secure'),
    readAutoProxy(snapshot.service),
  ]);
  const matches = (endpoint: ProxyEndpoint) =>
    endpoint.enabled && endpoint.server === '127.0.0.1' && endpoint.port === MITM_PORT;
  if (matches(web)) await setEndpoint(snapshot.service, 'web', snapshot.web);
  if (matches(secure)) await setEndpoint(snapshot.service, 'secure', snapshot.secure);
  if (!auto.enabled) {
    if (snapshot.auto.url) {
      await run(NETWORK_SETUP, ['-setautoproxyurl', snapshot.service, snapshot.auto.url]);
    }
    await run(NETWORK_SETUP, ['-setautoproxystate', snapshot.service, snapshot.auto.enabled ? 'on' : 'off']);
  }
}

async function serialize(task: () => Promise<void>) {
  if (operation) await operation;
  operation = task();
  try {
    await operation;
  } finally {
    operation = null;
  }
}

export async function detectCredentialUpstream(): Promise<string | null> {
  if (process.platform !== 'darwin') return process.env.CREDENTIAL_UPSTREAM_PROXY?.trim() || null;
  const state = await readState();
  if (state.managed && state.snapshot) return resolveUpstream(state.snapshot);
  return resolveUpstream(await captureSnapshot());
}

export async function enableSystemProxy(options: { rememberConsent?: boolean } = {}) {
  await serialize(async () => {
    if (process.platform !== 'darwin') throw new Error('系统代理自动托管目前仅支持 macOS');
    const currentState = await readState();
    if (currentState.managed) return;

    const snapshot = await captureSnapshot();
    const upstreamProxy = resolveUpstream(snapshot);
    if (isCredentialMitmEndpoint(upstreamProxy)) {
      throw new Error('上游代理与 mitmproxy 监听端口相同，会造成代理循环');
    }
    if (!mitmRuntime.ready) throw new Error('Credential 抓包服务尚未确认监听成功');
    if (normalizeProxyUrl(upstreamProxy) !== mitmRuntime.upstreamProxy) {
      throw new Error('系统代理上游已变化，请重启项目后再启用 Credential 抓取');
    }
    if (upstreamProxy) await checkPort(upstreamProxy, 'Clash 上游代理');
    await checkPort(`http://127.0.0.1:${MITM_PORT}`, 'Credential 抓包服务');

    const pendingState: StoredProxyState = {
      consent: options.rememberConsent ?? currentState.consent,
      managed: true,
      phase: 'applying',
      upstreamProxy,
      snapshot,
    };
    await saveState(pendingState);
    try {
      await applyMitmProxy(snapshot);
      await saveState({ ...pendingState, phase: 'managed' });
      lastError = null;
    } catch (error) {
      try {
        await applySnapshot(snapshot);
        await saveState({ ...pendingState, managed: false, phase: null });
      } catch (restoreError: any) {
        lastError = `代理配置失败且自动恢复失败：${restoreError?.message || restoreError}`;
        throw new Error(lastError, { cause: error });
      }
      throw error;
    }
  });
}

export async function restoreSystemProxy(options: { clearConsent?: boolean } = {}) {
  await serialize(async () => {
    const state = await readState();
    if (state.snapshot) {
      if (state.managed) await restoreManagedSnapshot(state.snapshot);
    }
    await saveState({
      consent: options.clearConsent ? false : state.consent,
      managed: false,
      phase: null,
      upstreamProxy: state.upstreamProxy,
      snapshot: null,
    });
    lastError = null;
  });
}

export async function recoverStaleSystemProxy() {
  const state = await readState();
  if (!state.managed || !state.snapshot) return;
  try {
    await restoreSystemProxy();
  } catch (error: any) {
    lastError = `恢复上次系统代理失败：${error?.message || error}`;
  }
}

export async function autoEnableSystemProxy() {
  const state = await readState();
  if (!state.consent || state.managed) return;
  try {
    await enableSystemProxy();
  } catch (error: any) {
    lastError = error?.message || String(error);
  }
}

export async function getSystemProxyStatus(
  options: { includeConfirmationToken?: boolean } = {}
): Promise<SystemProxyStatus> {
  if (process.platform !== 'darwin') {
    return {
      supported: false,
      managed: false,
      consent: false,
      networkService: null,
      upstreamProxy: getSafeProxyUrl(process.env.CREDENTIAL_UPSTREAM_PROXY?.trim() || null),
      mitmProxy: `http://127.0.0.1:${MITM_PORT}`,
      confirmationToken: null,
      error: '系统代理自动托管目前仅支持 macOS',
    };
  }

  const state = await readState();
  let networkService = state.snapshot?.service || null;
  let upstreamProxy = state.upstreamProxy;
  try {
    if (!networkService || !upstreamProxy) {
      const snapshot = await captureSnapshot();
      networkService = snapshot.service;
      upstreamProxy ||= resolveUpstream(snapshot);
    }
  } catch (error: any) {
    lastError ||= error?.message || String(error);
  }

  return {
    supported: true,
    managed: state.managed,
    consent: state.consent,
    networkService,
    upstreamProxy: getSafeProxyUrl(upstreamProxy),
    mitmProxy: `http://127.0.0.1:${MITM_PORT}`,
    confirmationToken: options.includeConfirmationToken ? confirmationToken : null,
    error: lastError,
  };
}

export function isLoopbackRequest(event: H3Event) {
  const remoteAddress = event.node.req.socket.remoteAddress || '';
  if (remoteAddress) return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remoteAddress);
  return (
    process.env.NODE_ENV === 'development' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(getRequestURL(event).hostname)
  );
}

export function assertSystemProxyRequest(event: H3Event) {
  const origin = getRequestHeader(event, 'origin');
  const requestUrl = getRequestURL(event);
  if (
    !isLoopbackRequest(event) ||
    !origin ||
    origin !== requestUrl.origin ||
    !['localhost', '127.0.0.1', '::1', '[::1]'].includes(requestUrl.hostname)
  ) {
    throw createError({ statusCode: 403, statusMessage: '仅允许本机同源请求管理系统代理' });
  }
  if (getRequestHeader(event, 'x-credential-proxy-token') !== confirmationToken) {
    throw createError({ statusCode: 403, statusMessage: '系统代理确认令牌无效' });
  }
}
