import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../electron/services/pi-adapter', () => ({
  loadPiAdapter: vi.fn(),
}));

vi.mock('../../electron/main/ipc/host-events', () => ({
  sendHostEvent: vi.fn(),
}));

const { loadPiAdapter } = await import('../../electron/services/pi-adapter');
const { projectTrustApi } = await import('../../electron/services/project-trust');

describe('projectTrustApi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects empty or invalid requestId in respond', () => {
    // @ts-expect-error testing missing payload
    expect(projectTrustApi.respond({}).success).toBe(false);
    expect(projectTrustApi.respond({ requestId: '' }).success).toBe(false);
    expect(projectTrustApi.respond({ requestId: '   ' }).success).toBe(false);
  });

  it('rejects invalid or device path in set', async () => {
    const emptyRes = await projectTrustApi.set({ path: '', decision: true });
    expect(emptyRes.success).toBe(false);
    expect(emptyRes.error).toBe('invalid-path');

    const devRes = await projectTrustApi.set({ path: 'CON', decision: true });
    expect(devRes.success).toBe(false);
    expect(devRes.error).toBe('device paths are not allowed');
  });

  it('rejects invalid decision in set', async () => {
    // @ts-expect-error testing invalid decision type
    const res = await projectTrustApi.set({ path: '/repo', decision: 'yes' });
    expect(res.success).toBe(false);
    expect(res.error).toBe('invalid-decision');
  });

  it('allows valid boolean or null decisions and delegates to adapter', async () => {
    const mockSet = vi.fn().mockResolvedValue(undefined);
    const mockList = vi.fn().mockReturnValue([]);
    vi.mocked(loadPiAdapter).mockResolvedValue({
      trust: {
        set: mockSet,
        listEntries: mockList,
      },
    } as any);

    const trueRes = await projectTrustApi.set({ path: ' /repo ', decision: true });
    expect(trueRes.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('/repo', true);

    const nullRes = await projectTrustApi.set({ path: '/repo', decision: null });
    expect(nullRes.success).toBe(true);
    expect(mockSet).toHaveBeenCalledWith('/repo', null);
  });

  it('草稿沙箱目录直接自动信任并返回 Trust，不向渲染层抛出选择弹窗', async () => {
    const { requestTrustSelection } = await import('../../electron/services/project-trust');
    const { ensureScratchpadSessionDir } = await import('../../electron/utils/scratchpad');
    const scratchpadCwd = await ensureScratchpadSessionDir('test_trust_bypass');

    const res = await requestTrustSelection(scratchpadCwd, 'Trust this folder?', [
      'Trust',
      'Do not trust',
    ]);
    expect(res).toBe('Trust');
    expect(projectTrustApi.listPending()).toHaveLength(0);
  });
});

