'use client';

import { ACCENT, AMBER, GREEN, RED, BLUE } from '@/lib/theme';
import { STATUS_LABELS } from '@/lib/utils';

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

const STATUS_COLORS: Record<string, string> = {
  awaiting: AMBER,
  half_fulfilled: AMBER,
  fulfilled: GREEN,
  nothing_found: RED,
  returned: BLUE,
};

export function StatusBadge({ status }: { status: string }) {
  const color = STATUS_COLORS[status] || AMBER;
  return (
    <span
      style={{
        font: "600 10.5px 'Inter', sans-serif",
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
        font: "600 10px 'Inter', sans-serif",
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
