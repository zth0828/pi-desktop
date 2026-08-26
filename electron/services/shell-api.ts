// shell 模块：打开外部链接与工作区文件等系统交互。
import { execFile } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { app, shell } from 'electron';
import type {
  HostSuccess,
  ShellApplication,
  ShellListApplicationsResult,
  ShellOpenExternalPayload,
  ShellOpenPathWithPayload,
} from '@shared/host-api/contract';

const execFileAsync = promisify(execFile);

// 只把适合作为代码/文件工作流入口的应用放进“打开方式”；实际是否安装仍由系统动态发现。
const RELEVANT_APP_PATTERNS = [
  /cursor/i, /finder/i, /terminal/i, /ghostty/i, /iterm/i, /warp/i,
  /visual studio code/i, /^code$/i, /xcode/i, /android studio/i, /intellij/i,
  /webstorm/i, /pycharm/i, /goland/i, /clion/i, /rider/i, /fleet/i,
  /sublime/i, /^zed$/i, /textedit/i, /bbedit/i, /nova/i, /coteditor/i,
  /codeedit/i, /windsurf/i, /trae/i, /emacs/i, /^vim/i,
];

function isRelevantApplication(name: string): boolean {
  return RELEVANT_APP_PATTERNS.some((pattern) => pattern.test(name));
}

async function attachNativeIcons(applications: ShellApplication[]): Promise<ShellApplication[]> {
  return Promise.all(applications.map(async (application) => {
    try {
      const icon = await app.getFileIcon(application.path, { size: 'small' });
      if (!icon.isEmpty()) return { ...application, iconDataUrl: icon.toDataURL() };
    } catch {
      // Some Linux desktop entries and sandboxed app paths do not expose icons.
    }
    return application;
  }));
}

async function macApplications(): Promise<ShellApplication[]> {
  const roots = ['/Applications', '/System/Applications', path.join(os.homedir(), 'Applications')];
  const found = new Map<string, ShellApplication>();
  try {
    const results = await Promise.all(roots.map(async (root) => {
      try {
        const { stdout } = await execFileAsync('mdfind', ['-onlyin', root, 'kMDItemContentType == "com.apple.application-bundle"'], { timeout: 5000 });
        return stdout.split('\n').map((entry) => entry.trim()).filter(Boolean);
      } catch {
        return [];
      }
    }));
    for (const appPath of results.flat()) {
      const name = path.basename(appPath, '.app');
      if (name) found.set(appPath, { id: appPath, name, path: appPath });
    }
  } catch {
    // Spotlight is optional; directory scanning below still provides a useful menu.
  }
  for (const root of roots) {
    try {
      for (const name of await readdir(root)) {
        if (!name.endsWith('.app')) continue;
        const appPath = path.join(root, name);
        found.set(appPath, { id: appPath, name: name.slice(0, -4), path: appPath });
      }
    } catch {
      // A missing Applications directory is expected on some test platforms.
    }
  }
  return [...found.values()].filter((application) => isRelevantApplication(application.name)).sort((a, b) => a.name.localeCompare(b.name));
}

async function discoveredApplications(): Promise<ShellListApplicationsResult> {
  if (process.platform === 'darwin') {
    const applications = (await macApplications()).slice(0, 20);
    return { applications: await attachNativeIcons(applications) };
  }
  const roots = process.platform === 'win32'
    ? [process.env['ProgramFiles'], process.env['ProgramFiles(x86)']].filter((entry): entry is string => Boolean(entry))
    : ['/usr/share/applications', path.join(os.homedir(), '.local/share/applications')];
  const applications: ShellApplication[] = [];
  for (const root of roots) {
    try {
      for (const name of await readdir(root)) {
        if (process.platform === 'win32' ? !name.endsWith('.exe') : !name.endsWith('.desktop')) continue;
        applications.push({ id: path.join(root, name), name: name.replace(/\.(desktop|exe)$/i, ''), path: path.join(root, name) });
      }
    } catch {
      // Ignore unavailable platform application directories.
    }
  }
  const relevant = applications
    .filter((application) => isRelevantApplication(application.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 20);
  return { applications: await attachNativeIcons(relevant) };
}

async function openPath(payload: { path: string }): Promise<HostSuccess> {
  try {
    const target = path.resolve(payload.path);
    try {
      await stat(target);
    } catch {
      return { success: false, error: 'file-not-found' };
    }
    const error = await shell.openPath(target);
    return error ? { success: false, error } : { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function openPathWith(payload: ShellOpenPathWithPayload): Promise<HostSuccess> {
  const target = path.resolve(payload.path);
  try {
    try {
      await stat(target);
    } catch {
      return { success: false, error: 'file-not-found' };
    }
    if (process.platform === 'darwin' && payload.application.path.endsWith('.app')) {
      await execFileAsync('open', ['-a', payload.application.path, target], { timeout: 15_000 });
    } else {
      const result = await openPath({ path: target });
      if (!result.success) throw new Error(result.error);
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export const shellApi = {
  openExternal: async (payload: ShellOpenExternalPayload) => {
    await shell.openExternal(payload.url);
  },
  listApplications: discoveredApplications,
  openPath,
  openPathWith,
  showInFolder: async (payload: { path: string }): Promise<HostSuccess> => {
    try {
      const target = path.resolve(payload.path);
      try {
        await stat(target);
        shell.showItemInFolder(target);
        return { success: true };
      } catch {
        // 如果文件本身已不存在，尝试打开其上层目录
        const parent = path.dirname(target);
        try {
          await stat(parent);
          await shell.openPath(parent);
          return { success: true };
        } catch {
          return { success: false, error: 'file-not-found' };
        }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
};
