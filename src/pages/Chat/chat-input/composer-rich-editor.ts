import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FileIcon } from '../../../components/FileIcon';
import { parseUserMessageTokens } from '../chat-message/user-mentions-parser';

/**
 * 创建可在 contenteditable 中内联渲染的文件实体胶囊 DOM
 */
export function createChipElement(relPath: string, chipId?: string): HTMLSpanElement {
  const fileName = relPath.includes('/')
    ? relPath.split('/').pop() || relPath
    : relPath.includes('\\')
      ? relPath.split('\\').pop() || relPath
      : relPath;

  const chip = document.createElement('span');
  chip.className = 'composer-inline-chip';
  chip.contentEditable = 'false';
  chip.setAttribute('data-file', relPath);
  if (chipId) {
    chip.setAttribute('data-chip-id', chipId);
  }
  chip.title = relPath;

  // 使用 FileIcon 渲染真实的语言/文件矢量图标
  const iconHtml = renderToStaticMarkup(React.createElement(FileIcon, { name: fileName, size: 14 }));

  chip.innerHTML = `
    <span class="composer-inline-chip-icon">${iconHtml}</span>
    <span class="composer-inline-chip-name">${escapeHtml(fileName)}</span>
    <button type="button" class="composer-inline-chip-remove" aria-label="Remove">×</button>
  `;

  return chip;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * 序列化编辑器中的内容为带 @file 的标准 Prompt 字符串
 */
export function serializeComposer(editor: HTMLElement): string {
  let result = '';

  for (const node of editor.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent?.replace(/\u00A0/g, ' ') || '';
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains('composer-inline-chip')) {
        const file = el.getAttribute('data-file') || '';
        result += file.includes(' ') ? `@"${file}"` : `@${file}`;
      } else if (el.nodeName === 'BR') {
        result += '\n';
      } else if (el.nodeName === 'DIV') {
        result += '\n' + serializeComposer(el);
      } else {
        result += el.innerText || '';
      }
    }
  }

  return result.replace(/^[\s\u00A0]+$/, '');
}

/**
 * 将序列化文本还原进富文本编辑器（创建文本节点与胶囊节点）
 */
export function populateComposer(editor: HTMLElement, text: string) {
  editor.innerHTML = '';
  if (!text) return;

  const tokens = parseUserMessageTokens(text);
  for (const token of tokens) {
    if (token.type === 'text') {
      if (token.text) {
        editor.appendChild(document.createTextNode(token.text));
      }
    } else if (token.type === 'file' && token.path) {
      const chip = createChipElement(token.path);
      editor.appendChild(chip);
      editor.appendChild(document.createTextNode('\u00A0'));
    }
  }
}

/**
 * 在当前光标处就地插入文件胶囊，并在其后追加一个不换行空格将光标置于其后
 */
export function insertChipAtCaret(
  editor: HTMLElement,
  relPath: string,
  atTokenRange?: { start: number; end: number },
  chipId?: string,
) {
  editor.focus();
  const sel = window.getSelection();
  const chip = createChipElement(relPath, chipId);
  const space = document.createTextNode('\u00A0');

  if (atTokenRange && atTokenRange.start >= 0) {
    const currentVal = serializeComposer(editor);
    const before = currentVal.slice(0, atTokenRange.start);
    const after = currentVal.slice(atTokenRange.end);
    const inserted = relPath.includes(' ') ? `@"${relPath}"` : `@${relPath}`;
    const full = `${before}${inserted}${after}`;
    populateComposer(editor, full);
    if (chipId) {
      const matchingChips = editor.querySelectorAll(`.composer-inline-chip[data-file="${relPath}"]`);
      if (matchingChips.length > 0) {
        matchingChips[matchingChips.length - 1].setAttribute('data-chip-id', chipId);
      }
    }
    moveCaretToEnd(editor);
    return;
  }

  if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(chip);
    chip.after(space);

    const nextRange = document.createRange();
    nextRange.setStartAfter(space);
    nextRange.collapse(true);
    sel.removeAllRanges();
    sel.addRange(nextRange);
  } else {
    editor.appendChild(chip);
    editor.appendChild(space);
    moveCaretToEnd(editor);
  }
}

/**
 * 从编辑器中移除指定或最后一个文件胶囊（及其后跟随的不换行空格）
 */
export function removeChip(editor: HTMLElement, chipId?: string, chipPath?: string): boolean {
  let targetChip: HTMLElement | null = null;
  if (chipId) {
    targetChip = editor.querySelector(`.composer-inline-chip[data-chip-id="${chipId}"]`);
  }
  if (!targetChip && chipPath) {
    const matchingChips = editor.querySelectorAll(`.composer-inline-chip[data-file="${chipPath}"]`);
    if (matchingChips.length > 0) {
      targetChip = matchingChips[matchingChips.length - 1] as HTMLElement;
    }
  }
  if (!targetChip) {
    const allChips = editor.querySelectorAll('.composer-inline-chip');
    if (allChips.length > 0) {
      targetChip = allChips[allChips.length - 1] as HTMLElement;
    }
  }
  if (!targetChip) return false;

  if (
    targetChip.nextSibling &&
    targetChip.nextSibling.nodeType === Node.TEXT_NODE &&
    (targetChip.nextSibling.textContent === '\u00A0' || targetChip.nextSibling.textContent === ' ')
  ) {
    targetChip.nextSibling.remove();
  }
  targetChip.remove();
  return true;
}

export function moveCaretToEnd(el: HTMLElement) {
  el.focus();
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

/**
 * 精确计算光标在富文本编辑器序列化字符串中的字符偏移量（供 @ 与 / 命令检测）
 */
export function getCaretCharacterOffsetWithin(element: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !element.contains(sel.anchorNode)) return 0;
  const range = sel.getRangeAt(0);
  const preCaretRange = range.cloneRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.endContainer, range.endOffset);

  let count = 0;
  const walker = document.createTreeWalker(
    preCaretRange.cloneContents(),
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList?.contains('composer-inline-chip')) {
          return NodeFilter.FILTER_ACCEPT;
        }
        if (node.parentNode && (node.parentNode as HTMLElement).closest?.('.composer-inline-chip')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      count += (node.textContent || '').replace(/\u00A0/g, ' ').length;
    } else if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList?.contains('composer-inline-chip')) {
      const f = (node as HTMLElement).getAttribute('data-file') || '';
      count += f.includes(' ') ? `@"${f}"`.length : `@${f}`.length;
    }
    node = walker.nextNode();
  }

  return count;
}
