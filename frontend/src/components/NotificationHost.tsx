'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/api';
import {
  appendUniqueNotification,
  notificationMessage,
  notificationVisibleForRole,
  type RequestNotification,
} from '@/lib/requestNotifications';
import { useRequestNotificationSocket } from '@/lib/socket';

const seenEventIds = new Set<string>();

export function NotificationHost({ role }: { role: Role }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<RequestNotification[]>([]);

  const dismiss = useCallback((eventId: string) => {
    setNotifications((current) => current.filter((item) => item.eventId !== eventId));
  }, []);

  useRequestNotificationSocket(useCallback((notification: RequestNotification) => {
    if (!notificationVisibleForRole(notification, role)
      || seenEventIds.has(notification.eventId)) return;
    seenEventIds.add(notification.eventId);
    setNotifications((current) => appendUniqueNotification(current, notification));
    window.setTimeout(() => dismiss(notification.eventId), 10_000);
  }, [dismiss, role]));

  return (
    <div aria-live="polite" aria-label="Request notifications" style={{ position: 'fixed', zIndex: 1000, top: 18, right: 18, width: 'min(390px, calc(100vw - 36px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {notifications.map((notification) => {
        const copy = notificationMessage(notification);
        return (
          <div
            key={notification.eventId}
            role="status"
            tabIndex={0}
            onClick={() => router.push(copy.href)}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget) return;
              if (event.key === 'Enter' || event.key === ' ') router.push(copy.href);
            }}
            style={{ position: 'relative', cursor: 'pointer', borderRadius: 12, border: '1px solid rgb(111 231 210 / 0.38)', background: '#101816', color: '#f3f7f6', boxShadow: '0 16px 40px rgb(0 0 0 / 0.28)', padding: '14px 42px 14px 16px' }}
          >
            <div style={{ font: "700 14px 'Inter', sans-serif", marginBottom: 5 }}>{copy.title}</div>
            <div style={{ font: "500 13px/1.45 'Inter', sans-serif", color: '#c8d5d1' }}>{copy.body}</div>
            <button
              type="button"
              aria-label={`Dismiss ${copy.title}`}
              onClick={(event) => {
                event.stopPropagation();
                dismiss(notification.eventId);
              }}
              style={{ position: 'absolute', top: 8, right: 8, width: 28, height: 28, border: 0, borderRadius: 7, background: 'transparent', color: '#9aaba6', cursor: 'pointer', fontSize: 19 }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
