export type DeliveryRoute =
  | 'internal_transfer'
  | 'customer_ship'
  | 'customer_dropoff';

export type FulfillmentChoice =
  | 'local_urgent'
  | 'local_dropoff'
  | 'local_ship'
  | 'local'
  | 'bt_to_rep_branch'
  | 'bt_customer_ship'
  | 'bt_customer_dropoff'
  | 'bt_to_branch';

const LOCAL_CHOICES: FulfillmentChoice[] = [
  'local_urgent',
  'local_dropoff',
  'local_ship',
  'local',
];

const BT_CHOICES: FulfillmentChoice[] = [
  'bt_to_rep_branch',
  'bt_customer_ship',
  'bt_customer_dropoff',
  'bt_to_branch',
];

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
  if (availability.status === 'not_in_snapshot') return 'Not in latest ERP snapshot';
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

export function fulfillmentChoicesFor(
  homeBranch: string | null,
  repBranch: string
): FulfillmentChoice[] {
  if (!homeBranch) return [];
  if (homeBranch === repBranch) return [...LOCAL_CHOICES];
  return [...BT_CHOICES];
}

export function defaultFulfillmentChoice(
  homeBranch: string | null,
  repBranch: string
): FulfillmentChoice | null {
  if (!homeBranch) return null;
  return homeBranch !== repBranch
    ? 'bt_to_rep_branch'
    : 'local';
}

export function fulfillmentChoiceLabel(
  choice: FulfillmentChoice,
  repBranch: string
) {
  const labels: Record<FulfillmentChoice, string> = {
    local_urgent: 'Urgent',
    local_dropoff: 'Drop off to customer',
    local_ship: 'Shipment to customer',
    local: `Local pickup (${repBranch})`,
    bt_to_rep_branch: `BT ship stone/cert to ${repBranch}`,
    bt_customer_ship: 'BT ship stone/cert to customer',
    bt_customer_dropoff: 'BT drop off stone/cert to customer',
    bt_to_branch: 'BT ship to another branch',
  };
  return labels[choice];
}

export function deliveryRouteForChoice(
  choice: FulfillmentChoice | null
): DeliveryRoute | null {
  if (!choice) return null;
  if (['local_ship', 'bt_customer_ship'].includes(choice)) {
    return 'customer_ship';
  }
  if (['local_dropoff', 'bt_customer_dropoff'].includes(choice)) {
    return 'customer_dropoff';
  }
  if (choice === 'bt_to_rep_branch' || choice === 'bt_to_branch') {
    return 'internal_transfer';
  }
  return null;
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

export function canResolveSourceItems(
  request: {
    status: string;
    fulfillmentBranch: string;
    deliveryRoute: DeliveryRoute | null;
    transferStatus: string | null;
  },
  actorBranch: string | null | undefined
) {
  if (!actorBranch || ['cancelled', 'fulfilled'].includes(request.status)) return false;
  if (actorBranch !== request.fulfillmentBranch) return false;
  const transferStatus = request.transferStatus || 'awaiting_source';
  if (request.deliveryRoute === 'internal_transfer') {
    return ['awaiting_source', 'packed'].includes(transferStatus);
  }
  if (request.deliveryRoute === 'customer_ship' || request.deliveryRoute === 'customer_dropoff') {
    return transferStatus === 'packed';
  }
  return true;
}

export function documentStepState({
  workflowVersion,
  crossBranch,
  erpTransferReceived,
  paperworkType,
  hasPaperwork,
  hasLabel,
}: {
  workflowVersion?: number;
  crossBranch?: boolean;
  erpTransferReceived?: boolean;
  paperworkType?: 'none' | 'pending' | 'invoice' | 'memo';
  hasPaperwork?: boolean;
  hasLabel?: boolean;
}) {
  const strictWorkflow = Number(workflowVersion || 1) >= 2;
  const paperworkEnabled = !strictWorkflow
    || !crossBranch
    || Boolean(erpTransferReceived);
  const paperworkComplete = strictWorkflow
    ? Boolean(hasPaperwork)
    : paperworkType !== 'pending';
  const labelEnabled = paperworkEnabled && paperworkComplete;
  return {
    paperworkEnabled,
    paperworkComplete,
    labelEnabled,
    ready: paperworkEnabled && paperworkComplete && Boolean(hasLabel),
  };
}
