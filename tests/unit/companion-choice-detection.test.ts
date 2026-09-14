import { describe, expect, it } from 'vitest';
import { isPromptingForChoices } from '../../src/pages/Chat/chat-message/companion-choice';

describe('companion-choice-detection (智能选项提问意图检测)', () => {
  it('正确识别包含多个数字序号并提示用户选择的提问', () => {
    const text1 = `请问您希望怎么处理？
1. 方案 A：使用内置状态
2. 方案 B：使用持久化存储
回复 1 或 2 即可。`;
    expect(isPromptingForChoices(text1)).toBe(true);

    const text2 = `这里有三种实现策略：
1) 策略一：直接改写
2) 策略二：创建适配层
3) 策略三：插件化机制
请告诉我您的选择？`;
    expect(isPromptingForChoices(text2)).toBe(true);

    const text3 = `Which option would you prefer?
1. Fast in-memory storage
2. Persistent sqlite database
Please reply with 1 or 2.`;
    expect(isPromptingForChoices(text3)).toBe(true);
  });

  it('正确识别序号形式（如 1、 2、 或 (1) (2)）', () => {
    const text = `您想采用哪项配置？
(1) 开启严格模式
(2) 保持兼容模式
请选择一项。`;
    expect(isPromptingForChoices(text)).toBe(true);
  });

  it('排除仅包含步骤说明的普通列表（无选择引导意图）', () => {
    const text = `代码修改步骤如下：
1. 更新 package.json
2. 运行构建命令
3. 提交变更
已为您完成全部步骤。`;
    expect(isPromptingForChoices(text)).toBe(false);
  });

  it('排除代码块内的序号内容', () => {
    const text = `请看这段代码示例：
\`\`\`ts
// 1. 初始化
// 2. 连接
\`\`\`
代码已就绪。`;
    expect(isPromptingForChoices(text)).toBe(false);
  });

  it('过短文本或无序号内容返回 false', () => {
    expect(isPromptingForChoices('')).toBe(false);
    expect(isPromptingForChoices('好的')).toBe(false);
    expect(isPromptingForChoices('请在 A 和 B 之间选择一个')).toBe(false);
  });
});
