'use client';

import { useState } from 'react';
import { ACCENT, AMBER, GREEN, RED, BLUE } from '@/lib/theme';
import { STATUS_LABELS } from '@/lib/utils';

// Wraps a barcode/cert number so clicking the text itself copies it — no
// separate "Copy" button anywhere in the app. Feedback is a brief text-color
// flash rather than appended text, so it never disturbs the tight grid
// layouts these values usually sit in. stopPropagation so a barcode inside a
// larger clickable row (e.g. an "add to cart" row) can be copied without
// also triggering the row's own click.
export function Copyable({
  value,
  children,
  className,
  style,
}: {
  value: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [copied, setCopied] = useState(false);

  async function handleClick(e: React.SyntheticEvent) {
    e.stopPropagation();
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1100);
    } catch {
      // Clipboard API unavailable (non-HTTPS/old browser) — nothing more we
      // can do without a fallback UI; fail silently rather than error out.
    }
  }

  return (
    <span
      role="button"
      tabIndex={0}
      className={className}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          handleClick(e);
        }
      }}
      title={copied ? 'Copied' : `Click to copy ${value}`}
      style={{
        cursor: value ? 'pointer' : 'default',
        transition: 'color 0.15s',
        ...style,
        // The "copied" flash must win over the caller's own color, but only
        // while it's actually showing — otherwise this permanently pins the
        // color and the caller's normal styling never applies.
        ...(copied ? { color: ACCENT } : {}),
      }}
    >
      {children ?? value}
    </span>
  );
}

// Click-to-toggle checkbox — a styled div with an inline SVG check, matching
// the prototype (not a native input). `accent` lets callers vary the fill.
export function Check({
  checked,
  onClick,
  disabled,
  accent = ACCENT,
  size = 18,
}: {
  checked: boolean;
  onClick?: () => void;
  disabled?: boolean;
  accent?: string;
  size?: number;
}) {
  return (
    <div
      role="checkbox"
      aria-checked={checked}
      tabIndex={disabled ? -1 : 0}
      onClick={
        disabled
          ? undefined
          : (e) => {
              e.stopPropagation();
              onClick?.();
            }
      }
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick?.();
        }
      }}
      style={{
        width: size,
        height: size,
        borderRadius: 5,
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: disabled ? 'default' : 'pointer',
        background: checked ? accent : 'transparent',
        border: `1.5px solid ${checked ? accent : 'oklch(45% 0.01 150)'}`,
        opacity: disabled ? 0.55 : 1,
        transition: 'background 0.12s, border-color 0.12s',
      }}
    >
      {checked && (
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="#0a0e0d" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 12l5 5L20 6" />
        </svg>
      )}
    </div>
  );
}

// A stone with no certificate on file — used wherever a barcode/cert cell
// would otherwise just show a blank dash, so "this one has no cert" is
// something inventory/reps notice at a glance, not something they have to
// infer from an empty cell.
export function NonCertBadge() {
  return (
    <span
      style={{
        font: "700 11.5px 'Inter', sans-serif",
        color: AMBER,
        background: AMBER.replace(')', ' / 0.14)'),
        border: `1px solid ${AMBER.replace(')', ' / 0.35)')}`,
        padding: '2px 7px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
      }}
    >
      NON-CERT
    </span>
  );
}

const STATUS_COLORS: Record<string, string> = {
  awaiting: AMBER,
  half_fulfilled: AMBER,
  fulfilled: GREEN,
  cancelled: RED,
  nothing_found: RED,
  returned: BLUE,
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || AMBER;
  return (
    <span
      style={{
        font: "600 12.5px 'Inter', sans-serif",
        color,
        background: `${color.replace(')', ' / 0.16)').replace('oklch(', 'oklch(')}`,
        padding: '3px 10px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
        border: `1px solid ${color.replace(')', ' / 0.3)')}`,
      }}
    >
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function DuplicateBadge({ reps }: { reps: string[] }) {
  const label = reps.length ? `Also: ${reps.join(', ')}` : 'Duplicate';
  return (
    <span
      title={label}
      style={{
        font: "600 12px 'Inter', sans-serif",
        color: RED,
        background: RED.replace(')', ' / 0.15)'),
        padding: '2px 8px',
        borderRadius: 20,
        whiteSpace: 'nowrap',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        maxWidth: 200,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        border: `1px solid ${RED.replace(')', ' / 0.35)')}`,
      }}
    >
      ⚠ duplicate
    </span>
  );
}

export function Avatar({ name, color, size = 32 }: { name: string; color: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#0a0e0d',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `600 ${size * 0.4}px 'Inter', sans-serif`,
        flex: 'none',
      }}
    >
      {initials}
    </div>
  );
}
