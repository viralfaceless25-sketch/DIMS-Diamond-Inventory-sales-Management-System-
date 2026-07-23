export type DeliveryRoute =
  | 'internal_transfer'
  | 'customer_ship'
  | 'customer_dropoff';

export interface AvailabilityLike {
  status: string;
  label?: string | null;
  repCount?: number;
  repName?: string | null;
}

export function canRequestAvailability(availability: AvailabilityLike) {
  return availability.status === 'in_stock';
}

export function availabilityText(availability: AvailabilityLike) {
  if (availability.label) return availability.label;
  if (availability.status === 'in_stock') return 'Available';
  if (availability.status === 'conflict') return `${availability.repCount || 0} reps`;
  if (availability.status === 'requested') return `With ${availability.repName || 'another sales rep'}`;
  if (availability.status === 'on_memo') return 'On Memo';
  if (availability.status === 'on_hold') return 'On Hold';
  if (availability.status === 'in_transit') return 'In Transit';
  return String(availability.status || 'Unavailable');
}

export function canAddToHomeBranch(
  currentHomeBranch: string | null,
  candidateHomeBranch: string
) {
  return !currentHomeBranch || currentHomeBranch === candidateHomeBranch;
}

export function fulfillmentLabel(
  route: DeliveryRoute,
  repBranch: string,
  homeBranch: string | null
) {
  if (route === 'customer_ship') return 'Ship directly to customer';
  if (route === 'customer_dropoff') return 'Sales rep drop-off';
  return homeBranch === repBranch
    ? `Stockroom pickup (${repBranch})`
    : `Ship to my branch (${repBranch})`;
}

export function requestTypeForFulfillment(
  route: DeliveryRoute,
  crossBranch: boolean
) {
  if (route === 'customer_dropoff') return 'dropoff' as const;
  if (route === 'customer_ship' || crossBranch) return 'ship' as const;
  return 'pickup' as const;
}

export function hasDeliveryWorkflow(
  crossBranch: boolean | null | undefined,
  route: DeliveryRoute | null | undefined
) {
  return Boolean(crossBranch) || route === 'customer_ship' || route === 'customer_dropoff';
}
