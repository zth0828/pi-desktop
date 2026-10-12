import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  start: vi.fn(() => 42),
  stop: vi.fn(),
  getSetting: vi.fn(),
  appendFileSync: vi.fn(),
}));

vi.mock('electron', () => ({
  powerSaveBlocker: {
    start: mocks.start,
    stop: mocks.stop,
  },
}));

vi.mock('@electron/services/settings-api', () => ({
  settingsApi: {
    get: mocks.getSetting,
  },
}));

vi.mock('node:fs', () => ({
  appendFileSync: mocks.appendFileSync,
}));

describe('powerSaveBlocker management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.PI_DESKTOP_E2E_POWER_LOG;
  });

  afterEach(async () => {
    const mod = await import('@electron/services/power-save');
    mod.noteRunEnded('active');
    mod.noteRunEnded('runtime-2');
  });

  it('settings 开启且首次 run 启动时申请 blocker', async () => {
    mocks.getSetting.mockResolvedValue(true);
    const mod = await import('@electron/services/power-save');

    mod.noteRunStarted('active');
    // 等待内部异步微任务
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.start).toHaveBeenCalledWith('prevent-display-sleep');

    // 运行结束时解除
    mod.noteRunEnded('active');
    expect(mocks.stop).toHaveBeenCalledWith(42);
  });

  it('settings 关闭时不启动 blocker', async () => {
    mocks.getSetting.mockResolvedValue(false);
    const mod = await import('@electron/services/power-save');

    mod.noteRunStarted('active');
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.start).not.toHaveBeenCalled();
    mod.noteRunEnded('active');
    expect(mocks.stop).not.toHaveBeenCalled();
  });

  it('E2E 日志在设置设备路径时静默跳过写入', async () => {
    process.env.PI_DESKTOP_E2E_POWER_LOG = 'CON';
    mocks.getSetting.mockResolvedValue(true);
    const mod = await import('@electron/services/power-save');

    mod.noteRunStarted('active');
    await Promise.resolve();
    await Promise.resolve();

    expect(mocks.appendFileSync).not.toHaveBeenCalled();
    mod.noteRunEnded('active');
    expect(mocks.appendFileSync).not.toHaveBeenCalled();
  });
});
