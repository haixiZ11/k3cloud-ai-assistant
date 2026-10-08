import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';

interface MarkdownBlockProps {
  content: string;
}

/**
 * Fenced code block wrapper — 两种复制入口,文本都从渲染后的 DOM 读取
 * (textContent),对 rehype-highlight 分词出的多层 span 结构天然正确:
 *   1. 左键点右上角悬浮按钮 — 一键复制整块,无需选中
 *   2. 右键任意位置 — 弹出"复制代码"菜单(Electron 没有默认右键菜单)
 */
function CodeBlock(props: React.HTMLAttributes<HTMLPreElement>) {
  const { t } = useTranslation();
  const preRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const copy = async (): Promise<void> => {
    const text = preRef.current?.textContent ?? '';
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  // 菜单打开期间:点别处 / Esc / 改窗口大小都关闭
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  return (
    <div
      className="md-code"
      onContextMenu={(e) => {
        e.preventDefault();
        // 右缘/下缘内收一点,避免菜单被窗口裁掉
        setMenu({
          x: Math.min(e.clientX, window.innerWidth - 140),
          y: Math.min(e.clientY, window.innerHeight - 60)
        });
      }}
    >
      <button
        type="button"
        className="md-code-copy"
        onClick={() => { void copy(); }}
      >
        {copied ? t('markdown.copied') : t('markdown.copyCode')}
      </button>
      <pre ref={preRef} {...props} />
      {menu && (
        <div className="md-code-menu" style={{ left: menu.x, top: menu.y }} role="menu">
          <button
            type="button"
            className="md-code-menu-item"
            role="menuitem"
            onClick={() => { void copy(); setMenu(null); }}
          >
            {t('markdown.copyCode')}
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Memoized — ReactMarkdown + rehype-highlight 对长文本的解析很贵,流式
 * 期间只动最后一条消息,历史消息的 MarkdownBlock 不应跟着重新解析。
 * 上层 Message 已 memo,这里再兜一层(同一消息内多个 block 互不影响)。
 */
export const MarkdownBlock = memo(function MarkdownBlock({ content }: MarkdownBlockProps) {
  // remark-breaks turns single '\n' into <br> — matches chat-style UX where
  // LLMs (and users) treat each newline as a visual line break. Without it,
  // CommonMark collapses multi-line A/B/C/D option lists into one paragraph.
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: ({ node, ...rest }) => <CodeBlock {...rest} />
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
