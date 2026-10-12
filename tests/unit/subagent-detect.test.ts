import { describe, expect, it } from 'vitest';
import { isSuggestingSubagent } from '../../src/pages/Chat/chat-message/subagent-detect';

describe('isSuggestingSubagent', () => {
  it('识别包含使用/建议 subagent 的中文回复', () => {
    expect(isSuggestingSubagent('这个任务比较复杂，建议使用 subagent 分别对前端与后端进行并发排查。')).toBe(true);
    expect(isSuggestingSubagent('我们可以通过 scout 工具快速分析工作区文件结构。')).toBe(true);
    expect(isSuggestingSubagent('需要派发子 agent 并行分析 Go 后端与 Tauri 桌面端代码。')).toBe(true);
  });

  it('识别包含 subagent 委派意图的英文回复', () => {
    expect(isSuggestingSubagent('I recommend using a subagent to investigate the backend issues.')).toBe(true);
    expect(isSuggestingSubagent('We can delegate this task to a subagent for parallel review.')).toBe(true);
    expect(isSuggestingSubagent('Let us run scout to explore the codebase entry points.')).toBe(true);
  });

  it('排除代码块内的 subagent 变量名或注释', () => {
    const codeSnippet = '```typescript\nconst subagent = new SubagentRunner();\nsubagent.run();\n```';
    expect(isSuggestingSubagent(codeSnippet)).toBe(false);

    const inlineCode = '你可以查看 `subagent.ts` 文件中的代码。';
    expect(isSuggestingSubagent(inlineCode)).toBe(false);
  });

  it('无明确动词/委派意图的随口提及不触发', () => {
    expect(isSuggestingSubagent('Subagent 架构是近期的热门话题。')).toBe(false);
    expect(isSuggestingSubagent('这是一个关于 AI 系统的分析报告。')).toBe(false);
  });

  it('空文本或过短文本安全处理', () => {
    expect(isSuggestingSubagent('')).toBe(false);
    expect(isSuggestingSubagent('subagent')).toBe(false);
  });
});
