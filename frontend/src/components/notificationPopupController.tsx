'use client';

import { useRef, type FocusEvent } from 'react';
import { notificationMessage, type RequestNotification } from '@/lib/requestNotifications';

const ACTIVE_DURATION_MS = 10_000;

export type NotificationTimerScheduler = {
  now: () => number;
  setTimeout: (callback: () => void, delay: number) => unknown;
  clearTimeout: (timer: unknown) => void;
};

type ActiveNotification = {
  notification: RequestNotification;
  remainingMs: number;
  startedAt: number | null;
  timer: unknown | null;
};

const browserScheduler: NotificationTimerScheduler = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
  clearTimeout: (timer) => globalThis.clearTimeout(timer as ReturnType<typeof setTimeout>),
};

export class NotificationPopupController {
  private readonly active = new Map<string, ActiveNotification>();

  constructor(
    private readonly onChange: (notifications: RequestNotification[]) => void,
    private readonly timers: NotificationTimerScheduler = browserScheduler
  ) {}

  // Active IDs are the dedupe scope. Removing an entry releases its ID, so IDs
  // cannot accumulate globally or suppress a later browser session.
  receive(notification: RequestNotification) {
    if (this.active.has(notification.eventId)) return;
    this.active.set(notification.eventId, {
      notification,
      remainingMs: ACTIVE_DURATION_MS,
      startedAt: null,
      timer: null,
    });
    this.publish();
    this.resume(notification.eventId);
  }

  pause(eventId: string) {
    const active = this.active.get(eventId);
    if (!active || active.timer === null || active.startedAt === null) return;
    this.timers.clearTimeout(active.timer);
    active.remainingMs = Math.max(0, active.remainingMs - (this.timers.now() - active.startedAt));
    active.timer = null;
    active.startedAt = null;
  }

  resume(eventId: string) {
    const active = this.active.get(eventId);
    if (!active || active.timer !== null) return;
    if (active.remainingMs <= 0) {
      this.dismiss(eventId);
      return;
    }
    active.startedAt = this.timers.now();
    active.timer = this.timers.setTimeout(() => {
      if (this.active.get(eventId) === active) this.dismiss(eventId);
    }, active.remainingMs);
  }

  dismiss(eventId: string) {
    const active = this.active.get(eventId);
    if (!active) return;
    if (active.timer !== null) this.timers.clearTimeout(active.timer);
    this.active.delete(eventId);
    this.publish();
  }

  dispose() {
    for (const active of this.active.values()) {
      if (active.timer !== null) this.timers.clearTimeout(active.timer);
    }
    this.active.clear();
  }

  private publish() {
    this.onChange([...this.active.values()].map((active) => active.notification));
  }
}

type NotificationPopupProps = {
  notification: RequestNotification;
  open: () => void;
  dismiss: () => void;
  pause: () => void;
  resume: () => void;
};

export function NotificationPopup({ notification, open, dismiss, pause, resume }: NotificationPopupProps) {
  const copy = notificationMessage(notification);
  const pointerWithin = useRef(false);
  const focusWithin = useRef(false);
  const resumeWhenFocusLeaves = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    focusWithin.current = false;
    if (!pointerWithin.current) resume();
  };

  return (
    <div aria-live="polite" aria-atomic="true">
      <div
        role="group"
        aria-label={`Request notification: ${copy.title}`}
        onPointerEnter={() => {
          pointerWithin.current = true;
          pause();
        }}
        onPointerLeave={() => {
          pointerWithin.current = false;
          if (!focusWithin.current) resume();
        }}
        onFocus={() => {
          focusWithin.current = true;
          pause();
        }}
        onBlur={resumeWhenFocusLeaves}
        style={{ position: 'relative', borderRadius: 12, border: '1px solid rgb(111 231 210 / 0.38)', background: '#101816', color: '#f3f7f6', boxShadow: '0 16px 40px rgb(0 0 0 / 0.28)', padding: '14px 16px' }}
      >
        <div style={{ font: "700 14px 'Inter', sans-serif", marginBottom: 5 }}>{copy.title}</div>
        <div style={{ font: "500 13px/1.45 'Inter', sans-serif", color: '#c8d5d1', marginBottom: 10 }}>{copy.body}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => { dismiss(); open(); }}>Open request</button>
          <button type="button" aria-label={`Dismiss ${copy.title}`} onClick={dismiss}>Dismiss</button>
        </div>
      </div>
    </div>
  );
}
