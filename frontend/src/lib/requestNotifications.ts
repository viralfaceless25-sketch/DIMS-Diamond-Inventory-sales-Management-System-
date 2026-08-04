import type { Role } from './api';

type NotificationBase = {
  eventId: string;
  requestId: number;
  fulfillmentBranch: string;
};

export type RequestCreatedNotification = NotificationBase & {
  kind: 'request-created';
  repName: string;
  repBranch: string;
  requestType: string;
  requestScope: string;
  itemCount: number;
  previewBarcodes: string[];
  remainingCount: number;
};

export type RequestViewedNotification = NotificationBase & {
  kind: 'request-viewed';
};

export type RequestConfirmedNotification = NotificationBase & {
  kind: 'request-confirmed';
  foundCount: number;
  notFoundCount: number;
};

export type RequestNotification =
  | RequestCreatedNotification
  | RequestViewedNotification
  | RequestConfirmedNotification;

export function isRequestNotification(value: unknown): value is RequestNotification {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RequestNotification>;
  if (typeof candidate.eventId !== 'string'
    || !Number.isInteger(candidate.requestId)
    || typeof candidate.fulfillmentBranch !== 'string') return false;
  if (candidate.kind === 'request-viewed') return true;
  if (candidate.kind === 'request-confirmed') {
    return typeof candidate.foundCount === 'number'
      && typeof candidate.notFoundCount === 'number';
  }
  if (candidate.kind === 'request-created') {
    return typeof candidate.repName === 'string'
      && typeof candidate.repBranch === 'string'
      && typeof candidate.itemCount === 'number'
      && Array.isArray(candidate.previewBarcodes)
      && candidate.previewBarcodes.every((barcode) => typeof barcode === 'string')
      && typeof candidate.remainingCount === 'number';
  }
  return false;
}

export function appendUniqueNotification(
  queue: RequestNotification[],
  incoming: RequestNotification
) {
  return queue.some((item) => item.eventId === incoming.eventId)
    ? queue
    : [...queue, incoming];
}

export function notificationVisibleForRole(
  notification: RequestNotification,
  role: Role
) {
  return role === 'inventory'
    ? notification.kind === 'request-created'
    : role === 'sales_rep' && notification.kind !== 'request-created';
}

export function notificationMessage(notification: RequestNotification) {
  if (notification.kind === 'request-created') {
    const preview = notification.previewBarcodes.join(', ');
    const remaining = notification.remainingCount > 0
      ? ` +${notification.remainingCount} more`
      : '';
    return {
      title: `New request #${notification.requestId}`,
      body: `${notification.repName} (${notification.repBranch}) requested ${notification.itemCount} item${notification.itemCount === 1 ? '' : 's'}: ${preview}${remaining}`,
      href: `/dashboard/requests?requestId=${notification.requestId}`,
    };
  }
  if (notification.kind === 'request-viewed') {
    return {
      title: `Request #${notification.requestId} viewed`,
      body: `${notification.fulfillmentBranch} inventory opened your request.`,
      href: `/rep/my-requests?requestId=${notification.requestId}`,
    };
  }
  return {
    title: `Request #${notification.requestId} confirmed`,
    body: `${notification.fulfillmentBranch} inventory confirmed your request. You will receive it soon.`,
    href: `/rep/my-requests?requestId=${notification.requestId}`,
  };
}
