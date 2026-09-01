import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bug,
  Compass,
  FlaskConical,
  Sparkles,
} from 'lucide-react';
import logoUrl from '../../../resources/icon.png';
import { usePaneChatStore } from './chat-store-context';

interface ChatGreetingProps {
  cwd?: string;
}

export function ChatGreeting({ cwd: _cwd }: ChatGreetingProps) {
  const { t } = useTranslation();
  const rawPhrases = t('chat.greetingRotating', { returnObjects: true }) as string[];
  const phrases = Array.isArray(rawPhrases) && rawPhrases.length > 0 ? rawPhrases : [t('chat.greeting')];

  const [phraseIndex, setPhraseIndex] = useState(0);
  const [displayedText, setDisplayedText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const setComposerText = usePaneChatStore((s) => s.setComposerText);

  useEffect(() => {
    const currentPhrase = phrases[phraseIndex % phrases.length];
    let timer: ReturnType<typeof setTimeout>;

    if (!isDeleting) {
      // 逐字正向敲出
      if (displayedText.length < currentPhrase.length) {
        timer = setTimeout(() => {
          setDisplayedText(currentPhrase.slice(0, displayedText.length + 1));
        }, 110);
      } else {
        // 敲完一句后驻留 2.6 秒供用户舒适阅读
        timer = setTimeout(() => {
          setIsDeleting(true);
        }, 2600);
      }
    } else {
      // 逐字快速回退删除
      if (displayedText.length > 0) {
        timer = setTimeout(() => {
          setDisplayedText(currentPhrase.slice(0, displayedText.length - 1));
        }, 45);
      } else {
        // 删除完毕后短暂停顿 250ms，切换至下一句
        setIsDeleting(false);
        setPhraseIndex((prev) => (prev + 1) % phrases.length);
      }
    }

    return () => clearTimeout(timer);
  }, [displayedText, isDeleting, phraseIndex, phrases]);

  const handleSelectPrompt = (prompt: string) => {
    setComposerText(prompt);
    // 聚焦输入框以便用户直接编辑或发送
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="chat-input"]');
    textarea?.focus();
  };

  const cards = [
    {
      key: 'architecture',
      icon: <Compass size={18} className="greeting-card-icon icon-architecture" />,
      title: t('chat.greetingCards.architecture.title'),
      desc: t('chat.greetingCards.architecture.desc'),
      prompt: t('chat.greetingCards.architecture.prompt'),
    },
    {
      key: 'inspect',
      icon: <Bug size={18} className="greeting-card-icon icon-inspect" />,
      title: t('chat.greetingCards.inspect.title'),
      desc: t('chat.greetingCards.inspect.desc'),
      prompt: t('chat.greetingCards.inspect.prompt'),
    },
    {
      key: 'feature',
      icon: <Sparkles size={18} className="greeting-card-icon icon-feature" />,
      title: t('chat.greetingCards.feature.title'),
      desc: t('chat.greetingCards.feature.desc'),
      prompt: t('chat.greetingCards.feature.prompt'),
    },
    {
      key: 'test',
      icon: <FlaskConical size={18} className="greeting-card-icon icon-test" />,
      title: t('chat.greetingCards.test.title'),
      desc: t('chat.greetingCards.test.desc'),
      prompt: t('chat.greetingCards.test.prompt'),
    },
  ];

  return (
    <div className="chat-greeting" data-testid="chat-greeting">
      <div className="chat-greeting-hero">
        <img className="chat-greeting-logo" src={logoUrl} alt="Pi Desktop" draggable={false} />
        <h1 className="chat-greeting-title" aria-label={phrases[phraseIndex % phrases.length]}>
          <span>{displayedText || '\u00A0'}</span>
          <span className="chat-greeting-cursor" aria-hidden="true" />
        </h1>
      </div>

      <div className="chat-greeting-cards" role="region" aria-label="Starter prompts">
        {cards.map((card) => (
          <button
            key={card.key}
            type="button"
            className="chat-greeting-card"
            data-testid={`greeting-card-${card.key}`}
            onClick={() => handleSelectPrompt(card.prompt)}
          >
            <div className="greeting-card-header">
              {card.icon}
              <span className="greeting-card-title">{card.title}</span>
            </div>
            <p className="greeting-card-desc">{card.desc}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
