'use client';

import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { api, getToken } from './api';
import { isRequestNotification, RequestNotification } from './requestNotifications';

// Subscribes to real-time events for a branch. `onEvent` is called with the
// event name and payload for any of the backend's broadcast events. The
// simplest correct usage is to refetch the relevant data on any event.
export function useBranchSocket(
  branch: string,
  onEvent: (event: string, payload: unknown) => void
) {
  const socketRef = useRef<Socket | null>(null);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    const socket = io(api.apiUrl, {
      transports: ['websocket', 'polling'],
      auth: { token: getToken() },
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join-branch', branch || 'ALL');
    });

    const events = [
      'request:created',
      'request:updated',
      'request:completed',
      'stock:updated',
      'receipt:updated',
    ];
    events.forEach((ev) => {
      socket.on(ev, (payload: unknown) => handlerRef.current(ev, payload));
    });

    return () => {
      socket.disconnect();
    };
  }, [branch]);

  return socketRef;
}

export function useRequestNotificationSocket(
  onNotification: (notification: RequestNotification) => void
) {
  const handlerRef = useRef(onNotification);
  handlerRef.current = onNotification;

  useEffect(() => {
    const socket = io(api.apiUrl, {
      transports: ['websocket', 'polling'],
      auth: { token: getToken() },
    });
    const events = [
      'notification:request-created',
      'notification:request-viewed',
      'notification:request-confirmed',
    ];
    const receive = (payload: unknown) => {
      if (isRequestNotification(payload)) handlerRef.current(payload);
    };
    events.forEach((event) => socket.on(event, receive));

    return () => {
      socket.disconnect();
    };
  }, []);
}
