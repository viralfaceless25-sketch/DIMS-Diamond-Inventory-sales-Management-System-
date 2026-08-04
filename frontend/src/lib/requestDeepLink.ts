export function parseRequestDeepLinkId(value: string | null): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const requestId = Number(value);
  return Number.isSafeInteger(requestId) ? requestId : null;
}

export function requestDeepLinkError(value: string | null): string | null {
  if (value === null) return null;
  return parseRequestDeepLinkId(value) === null
    ? 'This notification does not contain a valid request number. Return to the request list and try the notification again.'
    : null;
}
