import { describe, expect, it } from 'vitest';
import { parseUserMessageTokens } from '../../src/pages/Chat/chat-message/user-mentions-parser';

describe('user-mentions (用户消息内联文件引用解析)', () => {
  it('正确解析普通文本中的 @filename 引用', () => {
    const raw = '我说的这个是属于侧边栏拖拽的那个情况 @go.mod 类似这样的效果';
    const tokens = parseUserMessageTokens(raw);
    expect(tokens).toEqual([
      { type: 'text', text: '我说的这个是属于侧边栏拖拽的那个情况 ' },
      { type: 'file', path: 'go.mod', name: 'go.mod', raw: '@go.mod' },
      { type: 'text', text: ' 类似这样的效果' },
    ]);
  });

  it('正确解析中文字符后直接紧跟的 @ 引用（无前置空格）', () => {
    const raw = '的复古风回家过节@index.html 大大说@package.json 结束';
    const tokens = parseUserMessageTokens(raw);
    expect(tokens).toEqual([
      { type: 'text', text: '的复古风回家过节' },
      { type: 'file', path: 'index.html', name: 'index.html', raw: '@index.html' },
      { type: 'text', text: ' 大大说' },
      { type: 'file', path: 'package.json', name: 'package.json', raw: '@package.json' },
      { type: 'text', text: ' 结束' },
    ]);
  });

  it('正确解析 Pi 展开的 <file> 块并还原在原句中的内联位置', () => {
    const raw = '查看 <file name="/Users/bingking/Desktop/FlowGate/go.mod">\nmodule flowgate\n</file>\n 的内容';
    const tokens = parseUserMessageTokens(raw);
    expect(tokens).toEqual([
      { type: 'text', text: '查看 ' },
      { type: 'file', path: '/Users/bingking/Desktop/FlowGate/go.mod', name: 'go.mod', raw: '__PI_MENTION__:/Users/bingking/Desktop/FlowGate/go.mod__' },
      { type: 'text', text: ' 的内容' },
    ]);
  });

  it('正确解析带空格的双引号引用 @"path with space/note.txt"', () => {
    const raw = '前面是文字 @"docs/test plan.md" 后面是文字';
    const tokens = parseUserMessageTokens(raw);
    expect(tokens).toEqual([
      { type: 'text', text: '前面是文字 ' },
      { type: 'file', path: 'docs/test plan.md', name: 'test plan.md', raw: '@"docs/test plan.md"' },
      { type: 'text', text: ' 后面是文字' },
    ]);
  });

  it('正确解析方括号形式 @[/path/to/walkthrough.md]', () => {
    const raw = '参考 @[/Users/bingking/walkthrough.md] 这个方案';
    const tokens = parseUserMessageTokens(raw);
    expect(tokens).toEqual([
      { type: 'text', text: '参考 ' },
      { type: 'file', path: '/Users/bingking/walkthrough.md', name: 'walkthrough.md', raw: '@[/Users/bingking/walkthrough.md]' },
      { type: 'text', text: ' 这个方案' },
    ]);
  });

  it('纯文本且无文件引用时，不产生额外文件 token', () => {
    const raw = '普通的讨论内容，没有包含任何文件引用。';
    const tokens = parseUserMessageTokens(raw);
    expect(tokens).toEqual([
      { type: 'text', text: '普通的讨论内容，没有包含任何文件引用。' },
    ]);
  });
});
