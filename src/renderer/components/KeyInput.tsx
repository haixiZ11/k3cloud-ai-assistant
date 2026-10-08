import { useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { useTranslation } from 'react-i18next';

interface KeyInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** 用户手动输入时回调(区别于受控回填)— 用于标记"未保存"。 */
  onUserEdit?: () => void;
  /** 失焦回调 — 向导里用于触发模型目录拉取 + 连通性测试。 */
  onBlur?: () => void;
  inputStyle?: CSSProperties;
  containerStyle?: CSSProperties;
}

/**
 * KeyInput — password input with reveal toggle + copy button.
 *
 * Keys are stored locally in plaintext either way (settings.json); the
 * masking is shoulder-surfing protection only. Users periodically need the
 * actual value back (paste into another tool, audit which key is which),
 * so hide-behind-dots-only was a dead end.
 */
export function KeyInput({
  value,
  onChange,
  placeholder,
  onUserEdit,
  onBlur,
  inputStyle,
  containerStyle
}: KeyInputProps): ReactElement {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async (): Promise<void> => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard denied — nothing sensible to do; the user can still reveal.
    }
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', ...containerStyle }}>
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onUserEdit?.();
        }}
        onBlur={onBlur}
        placeholder={placeholder}
        style={{
          flex: 1,
          minWidth: 200,
          padding: '8px 12px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'var(--surface)',
          color: 'var(--ink)',
          fontSize: 13,
          fontFamily: 'var(--font-mono)',
          ...inputStyle
        }}
      />
      <button
        type="button"
        className="btn"
        title={visible ? t('settings.hideKey') : t('settings.showKey')}
        onClick={() => setVisible((v) => !v)}
        style={{ padding: '8px 10px' }}
      >
        {visible ? '🙈' : '👁'}
      </button>
      <button
        type="button"
        className="btn"
        title={t('settings.copyKey')}
        disabled={!value}
        onClick={() => {
          void copy();
        }}
        style={{ padding: '8px 10px', minWidth: 44 }}
      >
        {copied ? '✓' : '⧉'}
      </button>
    </div>
  );
}
