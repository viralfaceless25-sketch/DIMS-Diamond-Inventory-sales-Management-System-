'use client';

import { useEffect, useRef, useState } from 'react';
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

// Small sticky-note icon that expands into a yellow note popup on click —
// for details that matter to one request but would clutter the row if shown
// inline (drop-off company/address today; any per-request note tomorrow).
// Click-outside and the icon itself both close it; renders nothing when
// every line is empty so it never appears on requests with nothing to show.
export function StickyNote({
  label = 'Note',
  lines,
}: {
  label?: string;
  lines: { heading?: string; value: string | null }[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const visibleLines = lines.filter((line) => line.value);
  if (visibleLines.length === 0) return null;

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', verticalAlign: 'middle' }}>
      <button
        type="button"
        onClick={(event) => { event.stopPropagation(); setOpen((v) => !v); }}
        title={label}
        aria-label={label}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 'none', background: 'none', cursor: 'pointer', color: AMBER, opacity: open ? 1 : 0.75 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 4h13l3 3v13H4V4z" />
          <path d="M17 4v6h6" />
        </svg>
      </button>
      {open && (
        <div
          onClick={(event) => event.stopPropagation()}
          style={{
            position: 'absolute', zIndex: 50, top: '100%', left: 0, marginTop: 6,
            minWidth: 220, maxWidth: 280, padding: '12px 14px',
            background: '#fff6c6', color: '#3a3320',
            border: '1px solid #e2d27a', borderRadius: 4,
            boxShadow: '0 10px 26px rgb(0 0 0 / 0.28)',
            transform: 'rotate(-0.6deg)',
          }}
        >
          {visibleLines.map((line, i) => (
            <div key={i} style={{ marginBottom: i === visibleLines.length - 1 ? 0 : 8 }}>
              {line.heading && <div style={{ font: "700 10.5px 'Inter'", letterSpacing: '0.04em', textTransform: 'uppercase', opacity: 0.65, marginBottom: 2 }}>{line.heading}</div>}
              <div style={{ font: "600 13px 'Inter'", whiteSpace: 'pre-wrap' }}>{line.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Drop-off request company/address — the details inventory and the rep both
// need to hand-carry a stone to the right customer, tucked behind a
// sticky-note icon so it doesn't compete for space with the request row.
export function DropoffNote({ company, address }: { company: string | null | undefined; address: string | null | undefined }) {
  return (
    <StickyNote
      label="Drop-off details"
      lines={[
        { heading: 'Company', value: company || null },
        { heading: 'Address', value: address || null },
      ]}
    />
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

// A failed load must never be rendered as an empty result: "No stones match"
// tells the user their data is gone when the request actually failed. This
// states what happened and offers the retry inline, rather than a
// window.alert that leaves the false-empty state behind once dismissed.
export function LoadError({
  message,
  onRetry,
  t,
}: {
  message: string;
  onRetry: () => void;
  t: { text: string; textFaint: string; bgCard: string; border: string };
}) {
  return (
    <div
      role="alert"
      style={{ padding: 26, textAlign: 'center', background: t.bgCard, border: `1px solid ${RED}`, borderRadius: 12 }}
    >
      <div style={{ font: "700 14px 'Inter'", color: t.text }}>Could not load this list.</div>
      <div style={{ marginTop: 5, font: "500 13px 'Inter'", color: t.textFaint }}>{message}</div>
      <button
        type="button"
        onClick={onRetry}
        style={{ marginTop: 13, padding: '8px 18px', borderRadius: 8, cursor: 'pointer', background: 'transparent', border: `1px solid ${t.border}`, color: t.text, font: "600 13px 'Inter'" }}
      >
        Retry
      </button>
    </div>
  );
}
