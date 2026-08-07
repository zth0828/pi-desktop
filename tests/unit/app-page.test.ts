import { describe, expect, it } from 'vitest';
import { initialAppPage, resolveAppPageId } from '@shared/app-page';

describe('app 初始页面解析', () => {
  it('支持 packages 作为 extensions 页的 CLI 别名', () => {
    expect(resolveAppPageId('packages')).toBe('extensions');
  });

  it('从 query 读取白名单页面', () => {
    expect(initialAppPage('?page=mcp')).toBe('mcp');
  });

  it('无效页面安全回退到 chat', () => {
    expect(initialAppPage('?page=unknown')).toBe('chat');
  });
});
