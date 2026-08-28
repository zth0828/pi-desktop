import type { ComposerAttachment } from '../../../stores/chat';
import type { PiModelRow } from '@shared/host-api/contract';

export type StagedImage = Extract<ComposerAttachment, { kind: 'image' }>;
export type StagedFile = Extract<ComposerAttachment, { kind: 'file' }>;
export type StagedAttachment = ComposerAttachment;

/** 光标处的 @ token（支持行首、空白、中日韩字符、标点符号后的 @，避免合法 email 误触） */
export type AtToken = { start: number; end: number; query: string };

export function detectAtToken(text: string, caret: number): AtToken | null {
  const before = text.slice(0, caret);
  const m = before.match(/(?:^|[\s\p{P}\p{S}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[^a-zA-Z0-9_])@([^\s@]*)$/u);
  if (!m) return null;
  const query = m[1];
  return { start: before.length - query.length - 1, end: caret, query };
}

export type ChatInputProps = {
  cwd: string;
  onChooseWorkspace: () => Promise<void>;
  /** 「选择模型」入口信号（nonce 递增触发打开模型菜单；0 = 无请求） */
  openModelMenuNonce?: number;
};

export type FollowupBehavior = 'queue' | 'steer';
export type SendWith = 'enter' | 'cmdEnter';

export function modelDisplayName(model: PiModelRow): string {
  let name = model.name ?? model.id;
  for (const suffix of [model.provider, model.providerLabel]) {
    if (!suffix) continue;
    if (name.toLowerCase().endsWith(` (${suffix.toLowerCase()})`)) {
      name = name.slice(0, -(suffix.length + 3));
    }
  }
  return name;
}

/** 流式中提交的排队方式：设置决定默认行为，Alt 反转（queue ↔ steer） */
export function resolveStreamBehavior(followupBehavior: FollowupBehavior, alt: boolean): 'steer' | 'followUp' {
  const base: 'steer' | 'followUp' = followupBehavior === 'steer' ? 'steer' : 'followUp';
  if (!alt) return base;
  return base === 'steer' ? 'followUp' : 'steer';
}

export function fileToStagedImage(file: File): Promise<StagedImage> {
  return new Promise((resolveFile, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolveFile({
        kind: 'image',
        name: file.name,
        data: dataUrl.split(',')[1] ?? '',
        mediaType: file.type || 'image/png',
        previewUrl: dataUrl,
      });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * 壳内建斜杠命令（与 main 侧 SHELL_BUILTIN_COMMANDS 对齐；pi TUI onSubmit 分发的壳映射）。
 * 不在此集合里的 /xxx 原样发给 pi（prompt 模板 / skill / 扩展命令由 pi 展开执行）。
 */
export const SHELL_BUILTIN_NAMES = new Set([
  'new',
  'compact',
  'tree',
  'model',
  'name',
  'copy',
  'export',
  'session',
  'settings',
  'login',
  'logout',
  'reload',
  'resume',
]);

/** 带参数的命令：补全面板选中后填入输入框补参数，不直接执行 */
export const ARG_BUILTIN_COMMANDS = new Set(['model', 'name', 'export', 'compact']);
