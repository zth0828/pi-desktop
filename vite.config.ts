import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';
import type { ChildProcess } from 'node:child_process';
import { DEV_RESTART_READY, DEV_RESTART_REQUEST } from './shared/dev-reload';

type ElectronChildProcess = ChildProcess & {
  send?: (message: string) => boolean;
};

type ViteProcess = NodeJS.Process & {
  electronApp?: ElectronChildProcess;
};

const viteProcess = process as ViteProcess;
let electronStarted = false;
let electronStarting = false;
let restartInFlight = false;

function launchElectron(options: { startup: () => Promise<void> }): void {
  electronStarting = true;
  void options.startup()
    .catch((error: unknown) => {
      console.error('Failed to start Electron:', error);
    })
    .finally(() => {
      electronStarting = false;
    });
}

/**
 * Keep the Electron process alive while pi is running. Main/preload changes
 * are applied on the next safe restart instead of aborting the current turn.
 */
function startOrRequestRestart(options: { startup: () => Promise<void> }): void {
  if (!electronStarted) {
    electronStarted = true;
    launchElectron(options);
    return;
  }

  const child = viteProcess.electronApp;
  if (!child || child.killed || !child.send) {
    // Both Electron entry builds call onstart during the initial build. Do not
    // spawn a second app while the first startup is still establishing IPC.
    if (electronStarting) return;
    launchElectron(options);
    return;
  }
  if (restartInFlight) return;

  restartInFlight = true;
  const onMessage = (message: unknown) => {
    if (message !== DEV_RESTART_READY) return;
    child.off('message', onMessage);
    restartInFlight = false;
    if (viteProcess.electronApp === child) launchElectron(options);
  };
  child.on('message', onMessage);
  child.send(DEV_RESTART_REQUEST);
}

const alias = {
  '@': resolve(__dirname, 'src'),
  '@electron': resolve(__dirname, 'electron'),
  '@shared': resolve(__dirname, 'shared'),
};

function isMainProcessExternal(id: string): boolean {
  if (!id || id.startsWith('\0')) return false;
  if (id.startsWith('.') || id.startsWith('/') || /^[A-Za-z]:[\\/]/.test(id)) return false;
  if (id.startsWith('@/') || id.startsWith('@electron/') || id.startsWith('@shared/')) return false;
  return true;
}

// Required for Electron: all asset URLs must be relative because the renderer
// loads via file:// in production.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron([
      {
        // Main process entry file
        entry: 'electron/main/index.ts',
        onstart(options) {
          startOrRequestRestart(options);
        },
        vite: {
          resolve: { alias },
          build: {
            outDir: 'dist-electron/main',
            rollupOptions: {
              external: isMainProcessExternal,
            },
          },
        },
      },
      {
        // Preload scripts entry file
        entry: 'electron/preload/index.ts',
        onstart(options) {
          startOrRequestRestart(options);
        },
        vite: {
          resolve: { alias },
          build: {
            outDir: 'dist-electron/preload',
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias,
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
