export interface ReceiptFormState {
  barcode: string;
  stoneReceived: boolean | null;
  certReceived: boolean | null;
  candidateCount: number;
  requestStoneId: number | null;
  sourceBranch: string;
  receivingBranch: string;
}

export function defaultCandidateId(
  candidates: { requestStoneId: number }[]
) {
  return candidates.length === 1 ? candidates[0].requestStoneId : null;
}

export function receiptFormReady(form: ReceiptFormState) {
  const barcode = form.barcode.trim();
  const explicitComponents =
    form.stoneReceived !== null && form.certReceived !== null;
  const hasComponent =
    form.stoneReceived === true || form.certReceived === true;
  const matchSelectionIsValid =
    form.candidateCount === 0
    || form.candidateCount === 1
    || (form.candidateCount > 1 && form.requestStoneId != null);
  const unmatchedSourceIsValid =
    form.candidateCount > 0
    || (
      Boolean(form.sourceBranch)
      && form.sourceBranch !== form.receivingBranch
    );

  return Boolean(
    barcode
    && explicitComponents
    && hasComponent
    && matchSelectionIsValid
    && unmatchedSourceIsValid
  );
}

export function shiftIsoDate(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const BRANCH_TIME_ZONES: Record<string, string> = {
  NY: 'America/New_York',
  LA: 'America/Los_Angeles',
  CH: 'America/Chicago',
};

export function branchToday(branch: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BRANCH_TIME_ZONES[branch] || BRANCH_TIME_ZONES.NY,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value])
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function componentSummary(
  stoneReceived: boolean,
  certReceived: boolean
) {
  return `Stone: ${stoneReceived ? 'Yes' : 'No'} · Cert: ${certReceived ? 'Yes' : 'No'}`;
}

// Batch scanning: when a barcode is added to the batch popup we pre-fill the
// Stone/Cert answers from the matched request's scope so the common case (the
// whole package arrived) needs no toggling, while the inventory user can still
// flip either answer to No. An unmatched barcode defaults to both Yes.
export function defaultComponents(requestScope?: string): {
  stoneReceived: boolean;
  certReceived: boolean;
} {
  if (requestScope === 'stone_only') return { stoneReceived: true, certReceived: false };
  if (requestScope === 'cert_only') return { stoneReceived: false, certReceived: true };
  return { stoneReceived: true, certReceived: true };
}

// A batch is submittable once every row that has not already been saved passes
// the same per-receipt validation the single-scan form uses.
export function batchReadyCount(rows: ReceiptFormState[]): number {
  return rows.filter((row) => receiptFormReady(row)).length;
}
