#!/usr/bin/env node
import { spawn } from 'node:child_process';
import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import path from 'node:path';

const PI_PACKAGE_NAME = '@earendil-works/pi-coding-agent';
const PAGE_ALIASES = new Map([
  ['chat', 'chat'],
  ['models', 'models'],
  ['sessions', 'sessions'],
  ['skills', 'skills'],
  ['packages', 'extensions'],
  ['extensions', 'extensions'],
  ['mcp', 'mcp'],
  ['settings', 'settings'],
]);

function usage() {
  console.log(`Usage: pnpm dev:local-pi -- [options]

Options:
  --pi <path>                 pi executable, cli.js, or package root
  --page <page>               chat|models|sessions|skills|packages|mcp|settings
  --unsafe-allow-outdated     allow a pi version below package.json piCompat.min
  --check                     validate and print the resolved configuration only
  --help                      show this help

Examples:
  pnpm dev:local-pi -- --page packages
  pnpm dev:local-pi -- --page chat --unsafe-allow-outdated
  pnpm dev:local-pi -- --pi /path/to/pi --check`);
}

function parseArgs(argv) {
  const options = { page: 'chat', unsafeAllowOutdated: false, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--') continue;
    if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--unsafe-allow-outdated') options.unsafeAllowOutdated = true;
    else if (arg === '--pi' || arg === '--page') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value`);
      if (arg === '--pi') options.pi = value;
      else options.page = value;
      index += 1;
    } else if (arg.startsWith('--pi=')) options.pi = arg.slice('--pi='.length);
    else if (arg.startsWith('--page=')) options.page = arg.slice('--page='.length);
    else throw new Error(`Unknown option: ${arg}`);
  }
  const page = PAGE_ALIASES.get(options.page.toLowerCase());
  if (!page) throw new Error(`Unsupported page: ${options.page}`);
  options.page = page;
  return options;
}

function findOnPath(bin) {
  const extensions = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  const ownModules = realpathSync(path.join(process.cwd(), 'node_modules'));
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const extension of extensions) {
      const candidate = path.join(dir, `${bin}${extension}`);
      if (!existsSync(candidate)) continue;
      try {
        accessSync(candidate, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        if (bin === 'pi') {
          const realCandidate = realpathSync(candidate);
          if (realCandidate.startsWith(`${ownModules}${path.sep}`)) continue;
        }
        return candidate;
      } catch {
        // Keep looking for another executable candidate.
      }
    }
  }
  return null;
}

function locatePackageRoot(inputPath) {
  const resolved = realpathSync(path.resolve(inputPath));
  let directory = statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        if (manifest.name === PI_PACKAGE_NAME) return { packageRoot: directory, manifest };
      } catch {
        // Continue walking up until the actual pi package is found.
      }
    }
    directory = path.dirname(directory);
  }
  return null;
}

function parseVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version.trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid version: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] < b[key] ? -1 : 1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

function packageEntry(manifest) {
  const rootExport = manifest.exports?.['.'];
  if (typeof rootExport === 'string') return rootExport;
  return rootExport?.import ?? manifest.main;
}

function validatePackage(packageRoot, manifest) {
  if (manifest.name !== PI_PACKAGE_NAME) throw new Error(`Expected ${PI_PACKAGE_NAME}`);
  if (typeof manifest.version !== 'string' || !parseVersion(manifest.version)) {
    throw new Error('pi package has no valid semantic version');
  }
  const entry = packageEntry(manifest);
  if (typeof entry !== 'string' || !existsSync(path.join(packageRoot, entry))) {
    throw new Error('pi SDK entry was not found');
  }
  const cli = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pi;
  if (typeof cli !== 'string' || !existsSync(path.join(packageRoot, cli))) {
    throw new Error('pi CLI entry was not found');
  }
}

function startDev(packageRoot, options) {
  const environment = {
    ...process.env,
    PI_DESKTOP_DEV_ALLOW_NON_NPM: '1',
    PI_DESKTOP_DEV_PI_PACKAGE_ROOT: packageRoot,
    PI_DESKTOP_DEV_INITIAL_PAGE: options.page,
  };
  if (options.unsafeAllowOutdated) environment.PI_DESKTOP_DEV_ALLOW_OUTDATED = '1';
  else delete environment.PI_DESKTOP_DEV_ALLOW_OUTDATED;

  const packageManagerScript = process.env.npm_execpath;
  const command = packageManagerScript ? process.execPath : process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
  const args = packageManagerScript ? [packageManagerScript, 'run', 'dev'] : ['run', 'dev'];
  const child = spawn(command, args, { cwd: process.cwd(), env: environment, stdio: 'inherit' });
  child.on('error', (error) => {
    console.error(`Failed to start dev server: ${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exitCode = code ?? 1;
  });
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    usage();
    process.exit(0);
  }

  const requestedPi = options.pi ?? findOnPath('pi');
  if (!requestedPi) throw new Error('pi was not found on PATH; pass --pi <path>');
  const located = locatePackageRoot(requestedPi);
  if (!located) throw new Error(`${requestedPi} is not inside ${PI_PACKAGE_NAME}`);
  validatePackage(located.packageRoot, located.manifest);

  const projectManifest = JSON.parse(readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'));
  const minimum = projectManifest.piCompat?.min;
  if (typeof minimum !== 'string' || !parseVersion(minimum)) {
    throw new Error('package.json piCompat.min is missing or invalid');
  }
  const isOutdated = compareVersions(located.manifest.version, minimum) < 0;
  if (isOutdated && !options.unsafeAllowOutdated) {
    throw new Error(
      `pi ${located.manifest.version} is below the supported minimum ${minimum}. `
      + 'Upgrade pi or pass --unsafe-allow-outdated for isolated debugging.',
    );
  }

  console.log(`pi package: ${located.packageRoot}`);
  console.log(`pi version: ${located.manifest.version}${isOutdated ? ' (unsafe outdated override)' : ''}`);
  console.log(`initial page: ${options.page}`);
  if (options.check) {
    console.log('check passed; dev server was not started');
  } else {
    startDev(located.packageRoot, options);
  }
} catch (error) {
  console.error(`dev:local-pi: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
