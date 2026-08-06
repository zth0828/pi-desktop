// Markdown 渲染：streamdown（流式优化）+ KaTeX + CJK。
// Ported from ClawX: src/components/markdown/streamdown-config.ts（插件/安全配置）
import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { Streamdown, defaultRehypePlugins } from 'streamdown';

const plugins = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
  math: createMathPlugin({ singleDollarTextMath: true }),
  cjk,
};

const { raw: _omittedRaw, ...safeRehype } = defaultRehypePlugins;

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  return (
    <Streamdown
      className="markdown"
      mode="streaming"
      parseIncompleteMarkdown={streaming ?? false}
      plugins={plugins}
      rehypePlugins={Object.values(safeRehype)}
      controls={{ code: { copy: true, download: false }, mermaid: false, table: false }}
      linkSafety={{ enabled: false }}
    >
      {text}
    </Streamdown>
  );
}
