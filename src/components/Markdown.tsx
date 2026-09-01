// Markdown 渲染：streamdown（流式优化）+ KaTeX + CJK。
// Ported from ClawX: src/components/markdown/streamdown-config.ts（插件/安全配置）
import { cjk } from '@streamdown/cjk';
import { createCodePlugin } from '@streamdown/code';
import { createMathPlugin } from '@streamdown/math';
import { Children, isValidElement, useState, type ComponentProps, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Streamdown, defaultRehypePlugins, type ExtraProps } from 'streamdown';
import { hostApi } from '../lib/host-api';
import { ImageLightbox } from '../pages/Chat/ImageLightbox';

const plugins = {
  code: createCodePlugin({ themes: ['github-light', 'github-dark'] }),
  math: createMathPlugin({ singleDollarTextMath: true }),
  cjk,
};

const { raw: _omittedRaw, ...safeRehype } = defaultRehypePlugins;

type MarkdownNode = {
  tagName?: string;
  properties?: { type?: string; checked?: boolean };
  children?: MarkdownNode[];
};

function taskProgress(children: ReactNode, node?: MarkdownNode): { completed: number; total: number } {
  let completed = 0;
  let total = 0;
  const visit = (value: ReactNode) => {
    Children.forEach(value, (child) => {
      if (!isValidElement(child)) return;
      const props = child.props as { type?: string; checked?: boolean; children?: ReactNode };
      if (child.type === 'input' && props.type === 'checkbox') {
        total += 1;
        if (props.checked) completed += 1;
      }
      visit(props.children);
    });
  };
  visit(children);
  const visitNode = (value?: MarkdownNode) => {
    if (!value) return;
    if (value.tagName === 'input' && value.properties?.type === 'checkbox') {
      total += 1;
      if (value.properties.checked) completed += 1;
    }
    value.children?.forEach(visitNode);
  };
  if (total === 0) visitNode(node);
  return { completed, total };
}

export function Markdown({ text, streaming }: { text: string; streaming?: boolean }) {
  const { t } = useTranslation();
  const [previewImage, setPreviewImage] = useState<{ url: string; name?: string } | null>(null);
  const components = {
    a: ({ href, children, ...props }: ComponentProps<'a'>) => (
      <a
        {...props}
        href={href}
        onClick={(event) => {
          event.preventDefault();
          if (href) void hostApi.shell.openExternal(href);
        }}
      >
        {children}
      </a>
    ),
    img: ({ src, alt, ...props }: ComponentProps<'img'>) => src ? (
      <button
        className="markdown-image-button"
        type="button"
        onClick={() => setPreviewImage({ url: src, name: typeof alt === 'string' ? alt : undefined })}
      >
        <img {...props} src={src} alt={alt ?? ''} />
      </button>
    ) : null,
    ul: ({ className, children, node: rawNode, ...props }: ComponentProps<'ul'> & ExtraProps) => {
      const progress = taskProgress(children, rawNode as unknown as MarkdownNode);
      if (progress.total === 0) return <ul {...props} className={className}>{children}</ul>;
      return (
        <section className="task-card" data-testid="task-card">
          <header>
            <span>{t('chat.taskList.title')}</span>
            <strong data-testid="task-progress">
              {t('chat.taskList.progress', progress)}
            </strong>
          </header>
          <ul {...props} className={className}>{children}</ul>
        </section>
      );
    },
  };
  return (
    <>
      <Streamdown
        className="markdown"
        mode="streaming"
        parseIncompleteMarkdown={streaming ?? false}
        plugins={plugins}
        components={components}
        rehypePlugins={Object.values(safeRehype)}
        controls={{ code: { copy: true, download: false }, mermaid: false, table: false }}
        linkSafety={{ enabled: false }}
      >
        {text}
      </Streamdown>
      {previewImage && <ImageLightbox src={previewImage.url} name={previewImage.name} onClose={() => setPreviewImage(null)} />}
    </>
  );
}
