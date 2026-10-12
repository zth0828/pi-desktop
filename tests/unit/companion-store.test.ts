import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCompanionStore } from '../../src/stores/companion';

const mockGetCompanionStatus = vi.fn();
const mockListPackages = vi.fn();

vi.mock('../../src/lib/host-api', () => ({
  hostApi: {
    piPackages: {
      getCompanionStatus: (id: string) => mockGetCompanionStatus(id),
      list: () => mockListPackages(),
    },
  },
}));

describe('useCompanionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useCompanionStore.setState({
      initialized: false,
      askQuestionInstalled: false,
      subagentsInstalled: false,
      loading: false,
      subagentsLoading: false,
      error: undefined,
    });
  });

  it('初始状态 initialized 为 false，扩展均为 false', () => {
    const state = useCompanionStore.getState();
    expect(state.initialized).toBe(false);
    expect(state.askQuestionInstalled).toBe(false);
    expect(state.subagentsInstalled).toBe(false);
  });

  it('fetchAllStatus 成功拉取两个扩展状态并标记 initialized = true', async () => {
    mockGetCompanionStatus.mockResolvedValueOnce({ id: 'ask-question', installed: true });
    mockListPackages.mockResolvedValueOnce({
      packages: [{ name: 'pi-subagents', source: 'npm:pi-subagents' }],
    });

    await useCompanionStore.getState().fetchAllStatus();

    const state = useCompanionStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.askQuestionInstalled).toBe(true);
    expect(state.subagentsInstalled).toBe(true);
  });

  it('当 packages 列表为空时，subagentsInstalled 识别为 false', async () => {
    mockGetCompanionStatus.mockResolvedValueOnce({ id: 'ask-question', installed: false });
    mockListPackages.mockResolvedValueOnce({ packages: [] });

    await useCompanionStore.getState().fetchAllStatus();

    const state = useCompanionStore.getState();
    expect(state.initialized).toBe(true);
    expect(state.askQuestionInstalled).toBe(false);
    expect(state.subagentsInstalled).toBe(false);
  });
});
