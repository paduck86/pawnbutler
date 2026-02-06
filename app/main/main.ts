// PawnButler - Electron Main Process

import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'node:path';
import { PawnButlerEngine } from '../../src/core/engine.js';
import { Guardian } from '../../src/safety/guardian.js';
import { ButlerAgent } from '../../src/agents/butler.js';
import { defaultConfig } from '../../src/config/default-config.js';
import {
  registerIPCHandlers,
  setupEventForwarding,
} from './ipc-handlers.js';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let engine: PawnButlerEngine | null = null;
let guardian: Guardian | null = null;
let butler: ButlerAgent | null = null;

function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

function createWindow(): void {
  const appRoot = app.getAppPath();

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'PawnButler',
    webPreferences: {
      preload: path.join(appRoot, 'dist-app', 'app', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
    show: false,
  });

  mainWindow.loadFile(
    path.join(appRoot, 'dist-app', 'app', 'renderer', 'index.html'),
  );

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  // Create a small 16x16 tray icon (empty image as placeholder)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show PawnButler',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.quit();
      },
    },
  ]);

  tray.setToolTip('PawnButler');
  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

async function initEngine(): Promise<void> {
  const config = { ...defaultConfig };

  // Create Guardian (safety layer)
  guardian = new Guardian(config);

  // Create Butler (orchestrator)
  butler = new ButlerAgent({ id: 'butler' });

  // Create Engine
  engine = new PawnButlerEngine(config);
  engine.registerAgent(butler);

  // Register IPC handlers
  registerIPCHandlers(engine, guardian, butler, getMainWindow);

  // Setup event forwarding to renderer
  setupEventForwarding(engine, getMainWindow);

  // Start the engine
  await engine.start();

  console.log('[PawnButler] Engine started');
}

// --- App lifecycle ---

app.whenReady().then(async () => {
  await initEngine();
  createWindow();
  createTray();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep app running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (engine) {
    console.log('[PawnButler] Shutting down engine...');
    await engine.shutdown();
    engine = null;
    console.log('[PawnButler] Engine stopped');
  }
});
