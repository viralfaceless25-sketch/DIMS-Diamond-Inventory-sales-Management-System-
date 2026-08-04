'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { Role } from '@/lib/api';
import {
  notificationMessage,
  notificationVisibleForRole,
  type RequestNotification,
} from '@/lib/requestNotifications';
import { useRequestNotificationSocket } from '@/lib/socket';
import { NotificationPopup, NotificationPopupController } from './notificationPopupController';

export function NotificationHost({ role }: { role: Role }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<RequestNotification[]>([]);
  const controllerRef = useRef<NotificationPopupController | null>(null);
  if (controllerRef.current === null) {
    controllerRef.current = new NotificationPopupController(setNotifications);
  }
  const controller = controllerRef.current;

  useEffect(() => () => controller.dispose(), [controller]);

  useRequestNotificationSocket(useCallback((notification: RequestNotification) => {
    if (notificationVisibleForRole(notification, role)) controller.receive(notification);
  }, [controller, role]));

  return (
    <div aria-label="Request notifications" style={{ position: 'fixed', zIndex: 1000, top: 18, right: 18, width: 'min(390px, calc(100vw - 36px))', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {notifications.map((notification) => (
        <NotificationPopup
          key={notification.eventId}
          notification={notification}
          open={() => {
            router.push(notificationMessage(notification).href);
          }}
          dismiss={() => controller.dismiss(notification.eventId)}
          pause={() => controller.pause(notification.eventId)}
          resume={() => controller.resume(notification.eventId)}
        />
      ))}
    </div>
  );
}
