'use strict';

const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 17891;
const PORT_ATTEMPTS = 20;
const SERVER_READY_TIMEOUT_MS = 30_000;

let mainWindow;
let nitroProcess;

function isDev() {
  return !app.isPackaged;
}

function getDevServerUrl() {
  return process.env.ELECTRON_DEV_SERVER_URL || 'http://127.0.0.1:3000';
}

function getBundledPath(...segments) {
  const appPath = app.getAppPath();

  if (app.isPackaged && appPath.endsWith('.asar')) {
    return path.join(path.dirname(appPath), 'app.asar.unpacked', ...segments);
  }

  return path.join(appPath, ...segments);
}

function getBundledNitroEntry() {
  return getBundledPath('.output', 'server', 'index.mjs');
}

function canListen(host, port) {
  return new Promise(resolve => {
    const server = net.createServer();

    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, host);
  });
}

async function findPort(host) {
  for (let offset = 0; offset < PORT_ATTEMPTS; offset += 1) {
    const port = DEFAULT_PORT + offset;
    if (await canListen(host, port)) {
      return port;
    }
  }

  throw new Error(`No available local port in range ${DEFAULT_PORT}-${DEFAULT_PORT + PORT_ATTEMPTS - 1}`);
}

function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(url, response => {
        response.resume();
        resolve();
      });

      request.once('error', error => {
        if (Date.now() > deadline) {
          reject(error);
          return;
        }

        setTimeout(check, 250);
      });

      request.setTimeout(2_000, () => {
        request.destroy(new Error('Timed out waiting for local Nitro server'));
      });
    };

    check();
  });
}

async function startNitroServer() {
  const host = DEFAULT_HOST;
  const port = await findPort(host);
  const serverEntry = getBundledNitroEntry();
  const userData = app.getPath('userData');
  const url = `http://${host}:${port}`;

  nitroProcess = spawn(process.execPath, [serverEntry], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      HOST: host,
      NITRO_HOST: host,
      PORT: String(port),
      NITRO_PORT: String(port),
      NITRO_KV_DRIVER: process.env.NITRO_KV_DRIVER || 'fs',
      NITRO_KV_BASE: process.env.NITRO_KV_BASE || path.join(userData, 'kv'),
      CREDENTIAL_SERVICE_DIR: process.env.CREDENTIAL_SERVICE_DIR || getBundledPath('credential-service'),
      CREDENTIAL_DATA_DIR: process.env.CREDENTIAL_DATA_DIR || path.join(userData, 'credential-service', 'data'),
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  nitroProcess.stdout.on('data', data => console.log(`[nitro] ${data}`.trimEnd()));
  nitroProcess.stderr.on('data', data => console.error(`[nitro] ${data}`.trimEnd()));
  nitroProcess.once('exit', (code, signal) => {
    nitroProcess = undefined;
    if (!app.isQuitting) {
      console.error(`Nitro server exited unexpectedly: code=${code} signal=${signal}`);
    }
  });

  await waitForHttp(url, SERVER_READY_TIMEOUT_MS);
  return url;
}

function createWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: 'WeChat Article Exporter',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const currentUrl = mainWindow.webContents.getURL();
    const currentOrigin = new URL(currentUrl).origin;
    const targetOrigin = new URL(targetUrl).origin;

    if (targetOrigin !== currentOrigin) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  mainWindow.loadURL(url);
}

async function bootstrap() {
  const url = isDev() ? getDevServerUrl() : await startNitroServer();
  createWindow(url);
}

app.once('ready', () => {
  bootstrap().catch(error => {
    console.error(error);
    app.quit();
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    bootstrap().catch(error => {
      console.error(error);
      app.quit();
    });
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (nitroProcess) {
    nitroProcess.kill();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
