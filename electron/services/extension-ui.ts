// 扩展 UI 桥：pi ExtensionUIContext 的 confirm/select/input → 渲染层对话框。
// 支持范围（ExtensionUIContext 可序列化子集，其余方法按 pi print 模式安全降级）：
//   confirm/select/input/editor — 经 piRuntime.uiRequest 事件推到渲染层，Promise 挂起
//     等 piRuntime.uiResponse 回传（按 requestId 配对）。
//   notify/status/working/文本 widget — 映射到 toast、状态条和 composer 插槽。
//   其余 TUI 专属（Component factory、footer/header/theme 等）— no-op。
// 竞态与超时：
//   - 会话替换（new/switch/fork）或 runtime 销毁时 cancelAllPendingUi() 取消全部
//     挂起请求（confirm→false，select/input→undefined），并通知渲染层移除对话框。
//   - 扩展传的 ExtensionUIDialogOptions.timeout / signal 由 main 侧兜底执行
//     （渲染层倒计时只是展示），防止渲染层异常导致 agent 永久挂起。
//   - Promise 永远 resolve（取消语义），不 reject：取消是 pi UI 协议的正常结果。
import { randomUUID } from 'node:crypto';
type ExtensionUIDialogOptions = { timeout?: number; signal?: AbortSignal };
type ExtensionUIContext = Record<string, unknown>;
import type {
  HostSuccess,
  PiExtensionUiState,
  PiUiRequestKind,
  PiUiRequestPayload,
  PiUiResponsePayload,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';

/** 请求发出的会话上下文快照（generation 供渲染层丢弃过期请求）。 */
export type UiRequestContext = { sessionId: string; generation: number };

type PendingEntry = {
  context: UiRequestContext;
  payload: PiUiRequestPayload;
  /** 取消语义下的 resolve 值（confirm=false，select/input=undefined） */
  cancelValue: string | boolean | undefined;
  finish: (value: string | boolean | undefined, notifyRenderer: boolean) => void;
};

const pending = new Map<string, PendingEntry>();

function cancelValueFor(kind: PiUiRequestKind): string | boolean | undefined {
  return kind === 'confirm' ? false : undefined;
}

function requestUi(
  ctx: UiRequestContext,
  kind: PiUiRequestKind,
  params: { title: string; message?: string; options?: string[]; placeholder?: string; prefill?: string },
  opts?: ExtensionUIDialogOptions,
): Promise<string | boolean | undefined> {
  const cancelValue = cancelValueFor(kind);
  if (opts?.signal?.aborted) return Promise.resolve(cancelValue);
  const requestId = randomUUID();
  const payload: PiUiRequestPayload = {
    requestId,
    sessionId: ctx.sessionId,
    generation: ctx.generation,
    kind,
    title: params.title,
    message: params.message,
    options: params.options,
    placeholder: params.placeholder,
    prefill: params.prefill,
    timeoutMs: opts?.timeout,
  };
  return new Promise((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (value: string | boolean | undefined, notifyRenderer: boolean) => {
      if (!pending.delete(requestId)) return;
      if (timer) clearTimeout(timer);
      opts?.signal?.removeEventListener('abort', onAbort);
      if (notifyRenderer) sendHostEvent('piRuntime', 'uiCancel', { requestId });
      resolve(value);
    };
    const onAbort = () => finish(cancelValue, true);
    pending.set(requestId, { context: ctx, payload, cancelValue, finish });
    if (opts?.timeout && opts.timeout > 0) {
      timer = setTimeout(() => finish(cancelValue, true), opts.timeout);
    }
    opts?.signal?.addEventListener('abort', onAbort, { once: true });
    sendHostEvent('piRuntime', 'uiRequest', payload);
  });
}

/** 渲染层用户响应：按 requestId 配对；未知 id（迟到/已取消）幂等忽略。 */
export function resolveUiResponse(payload: PiUiResponsePayload): HostSuccess {
  const entry = pending.get(payload.requestId);
  if (!entry) return { success: true };
  entry.finish(payload.cancelled ? entry.cancelValue : payload.value, false);
  return { success: true };
}

/** 取消所有挂起的 UI 请求（会话替换 / runtime 销毁时调用）。 */
export function cancelAllPendingUi(): void {
  for (const entry of [...pending.values()]) entry.finish(entry.cancelValue, true);
}

export function cancelPendingUiForContext(context: UiRequestContext): void {
  for (const entry of [...pending.values()]) {
    if (entry.context.sessionId === context.sessionId && entry.context.generation === context.generation) {
      entry.finish(entry.cancelValue, true);
    }
  }
}

export function getPendingUiRequests(context: UiRequestContext): PiUiRequestPayload[] {
  return [...pending.values()]
    .filter((entry) => entry.context.sessionId === context.sessionId && entry.context.generation === context.generation)
    .map((entry) => entry.payload);
}

const states = new Map<string, PiExtensionUiState>();

/**
 * TUI 专属能力的 no-op 不再静默：每个能力首次被扩展调用时打 main 日志 +
 * 渲染层 toast 提示一次（kind=unsupportedTui，文案在渲染层本地化）。
 */
const warnedUnsupported = new Set<string>();

function makeUnsupported(feature: string, getCtx: () => UiRequestContext) {
  return () => {
    if (!warnedUnsupported.has(feature)) {
      warnedUnsupported.add(feature);
      console.warn(`[extension-ui] TUI-only capability no-op in desktop: ${feature}`);
      sendHostEvent('piRuntime', 'uiNotification', {
        ...getCtx(),
        message: feature,
        level: 'warning',
        kind: 'unsupportedTui',
      });
    }
  };
}

function stateKey(ctx: UiRequestContext): string {
  return `${ctx.sessionId}:${ctx.generation}`;
}

function emptyUiState(ctx: UiRequestContext): PiExtensionUiState {
  return { ...ctx, statuses: [], widgets: [], workingVisible: true };
}

function publishUiState(state: PiExtensionUiState): void {
  states.set(stateKey(state), state);
  sendHostEvent('piRuntime', 'uiState', state);
}

export function resetExtensionUiState(ctx: UiRequestContext): void {
  publishUiState(emptyUiState(ctx));
}

export function getExtensionUiStateSnapshot(ctx: UiRequestContext): PiExtensionUiState {
  const key = stateKey(ctx);
  const current = states.get(key);
  if (current) return current;
  const empty = emptyUiState(ctx);
  states.set(key, empty);
  return empty;
}

/**
 * 构造传给 session.bindExtensions 的 uiContext。
 * 传入后 runner.hasUI() === true（uiContext !== noOpUIContext），扩展的
 * ctx.ui.confirm/select/input 才真正可用（print 模式默认无 UI）。
 */
export function createExtensionUIContext(getCtx: () => UiRequestContext): ExtensionUIContext {
  let state = emptyUiState(getCtx());
  publishUiState(state);
  const update = (patch: Partial<PiExtensionUiState>) => {
    state = { ...state, ...getCtx(), ...patch };
    publishUiState(state);
  };
  return {
    select: async (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
      (await requestUi(getCtx(), 'select', { title, options }, opts)) as string | undefined,
    confirm: async (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
      (await requestUi(getCtx(), 'confirm', { title, message }, opts)) === true,
    input: async (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
      (await requestUi(getCtx(), 'input', { title, placeholder }, opts)) as string | undefined,
    editor: async (title: string, prefill?: string) =>
      (await requestUi(getCtx(), 'editor', { title, prefill })) as string | undefined,
    notify: (message: string, level: 'info' | 'warning' | 'error' = 'info') => {
      sendHostEvent('piRuntime', 'uiNotification', { ...getCtx(), message, level });
    },
    // —— TUI 专属能力：安全 no-op ——
    onTerminalInput: () => () => {},
    setStatus: (key: string, text: string | undefined) => {
      const statuses = new Map(state.statuses.map((entry) => [entry.key, entry.text]));
      if (text === undefined) statuses.delete(key);
      else statuses.set(key, text);
      update({ statuses: [...statuses].map(([statusKey, statusText]) => ({ key: statusKey, text: statusText })) });
    },
    setWorkingMessage: (workingMessage?: string) => update({ workingMessage }),
    setWorkingVisible: (workingVisible: boolean) => update({ workingVisible }),
    setWorkingIndicator: makeUnsupported('setWorkingIndicator', getCtx),
    setHiddenThinkingLabel: (hiddenThinkingLabel?: string) => update({ hiddenThinkingLabel }),
    setWidget: (key: string, content: unknown, options?: { placement?: 'aboveEditor' | 'belowEditor' }) => {
      const widgets = new Map(state.widgets.map((widget) => [widget.key, widget]));
      if (!Array.isArray(content) || !content.every((line) => typeof line === 'string')) widgets.delete(key);
      else widgets.set(key, { key, lines: content, placement: options?.placement ?? 'aboveEditor' });
      update({ widgets: [...widgets.values()] });
    },
    setFooter: makeUnsupported('setFooter', getCtx),
    setHeader: makeUnsupported('setHeader', getCtx),
    setTitle: makeUnsupported('setTitle', getCtx),
    custom: async () => {
      makeUnsupported('custom', getCtx)();
      return undefined;
    },
    pasteToEditor: makeUnsupported('pasteToEditor', getCtx),
    setEditorText: makeUnsupported('setEditorText', getCtx),
    getEditorText: () => '',
    addAutocompleteProvider: makeUnsupported('addAutocompleteProvider', getCtx),
    setEditorComponent: makeUnsupported('setEditorComponent', getCtx),
    getEditorComponent: () => undefined,
    getAllThemes: () => [],
    getTheme: () => undefined,
    setTheme: () => ({ success: false, error: 'UI not available' }),
    getToolsExpanded: () => false,
    setToolsExpanded: () => {},
    // theme（TUI 配色对象）在壳里无意义，print 模式下扩展不应读取
    theme: undefined,
  } as unknown as ExtensionUIContext;
}
