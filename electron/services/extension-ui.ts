// 扩展 UI 桥：pi ExtensionUIContext 的 confirm/select/input → 渲染层对话框。
// 支持范围（ExtensionUIContext 全接口，非对话框方法给安全 no-op，与 pi 自己的
// print 模式 noOpUIContext 同策略）：
//   confirm/select/input — 经 piRuntime.uiRequest 事件推到渲染层，Promise 挂起
//     等 piRuntime.uiResponse 回传（按 requestId 配对）。
//   notify — 忽略（壳无 toast 基础设施）。
//   editor（多行编辑）— 不支持：直接 resolve undefined（取消语义）。降级为单行
//     input 会丢多行/保存语义，比明确取消更有害。
//   其余 TUI 专属（widget/footer/header/theme/editor 组件等）— no-op。
// 竞态与超时：
//   - 会话替换（new/switch/fork）或 runtime 销毁时 cancelAllPendingUi() 取消全部
//     挂起请求（confirm→false，select/input→undefined），并通知渲染层移除对话框。
//   - 扩展传的 ExtensionUIDialogOptions.timeout / signal 由 main 侧兜底执行
//     （渲染层倒计时只是展示），防止渲染层异常导致 agent 永久挂起。
//   - Promise 永远 resolve（取消语义），不 reject：取消是 pi UI 协议的正常结果。
import { randomUUID } from 'node:crypto';
import type {
  ExtensionUIDialogOptions,
  ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import type {
  HostSuccess,
  PiUiRequestKind,
  PiUiRequestPayload,
  PiUiResponsePayload,
} from '@shared/host-api/contract';
import { sendHostEvent } from '../main/ipc/host-events';

/** 请求发出的会话上下文快照（generation 供渲染层丢弃过期请求）。 */
export type UiRequestContext = { sessionId: string; generation: number };

type PendingEntry = {
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
  params: { title: string; message?: string; options?: string[]; placeholder?: string },
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
    pending.set(requestId, { cancelValue, finish });
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

/**
 * 构造传给 session.bindExtensions 的 uiContext。
 * 传入后 runner.hasUI() === true（uiContext !== noOpUIContext），扩展的
 * ctx.ui.confirm/select/input 才真正可用（print 模式默认无 UI）。
 */
export function createExtensionUIContext(getCtx: () => UiRequestContext): ExtensionUIContext {
  return {
    select: async (title: string, options: string[], opts?: ExtensionUIDialogOptions) =>
      (await requestUi(getCtx(), 'select', { title, options }, opts)) as string | undefined,
    confirm: async (title: string, message: string, opts?: ExtensionUIDialogOptions) =>
      (await requestUi(getCtx(), 'confirm', { title, message }, opts)) === true,
    input: async (title: string, placeholder?: string, opts?: ExtensionUIDialogOptions) =>
      (await requestUi(getCtx(), 'input', { title, placeholder }, opts)) as string | undefined,
    // 忽略：壳暂无 toast 基础设施
    notify: () => {},
    // 不支持多行编辑器：取消语义（见文件头说明）
    editor: async () => undefined,
    // —— TUI 专属能力：安全 no-op ——
    onTerminalInput: () => () => {},
    setStatus: () => {},
    setWorkingMessage: () => {},
    setWorkingVisible: () => {},
    setWorkingIndicator: () => {},
    setHiddenThinkingLabel: () => {},
    setWidget: () => {},
    setFooter: () => {},
    setHeader: () => {},
    setTitle: () => {},
    custom: async () => undefined,
    pasteToEditor: () => {},
    setEditorText: () => {},
    getEditorText: () => '',
    addAutocompleteProvider: () => {},
    setEditorComponent: () => {},
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
