import type {
  DeliveryRunStatus,
  DeliveryStopStatus,
  OrderDeliveryProposedOutcome,
  OrderDeliveryStatus,
  UserRole,
} from "./enums";

/**
 * Pure (no DB, no framework) rules for the Phase 14 delivery domain. The
 * server service layer and Mongoose model both call these so there is one
 * definition of every invariant. See CLAUDE.md "Phase 14" for the design.
 *
 * Two distinct concepts live here — do not merge them:
 *  - `Order.delivery` (per-order lifecycle, unchanged from Phase 2)
 *  - `DeliveryRun`    (one courier's batch of orders, each order = one stop)
 */

export type DeliveryRuleCode =
  | "EMPTY_RUN"
  | "DUPLICATE_ORDER"
  | "INVALID_SEQUENCE"
  | "REORDER_UNKNOWN_STOP"
  | "REORDER_NOT_PENDING"
  | "REORDER_INCOMPLETE";

export type RuleResult<T> = { ok: true; value: T } | { ok: false; code: DeliveryRuleCode; message: string };

function fail<T>(code: DeliveryRuleCode, message: string): RuleResult<T> {
  return { ok: false, code, message };
}

// ---------------------------------------------------------------- DeliveryRun status

export const DELIVERY_RUN_TRANSITIONS: Record<DeliveryRunStatus, readonly DeliveryRunStatus[]> = {
  draft: ["active", "cancelled"],
  active: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

export function canTransitionDeliveryRun(from: DeliveryRunStatus, to: DeliveryRunStatus): boolean {
  return DELIVERY_RUN_TRANSITIONS[from].includes(to);
}

/**
 * Not yet terminal — still cancellable. This is NOT about order reservation
 * (see RESERVING_DELIVERY_RUN_STATUS below); "draft" is on this list purely
 * because a draft can still be cancelled/discarded.
 */
export const OPEN_DELIVERY_RUN_STATUSES = ["draft", "active"] as const satisfies readonly DeliveryRunStatus[];

export function isOpenDeliveryRunStatus(status: DeliveryRunStatus): boolean {
  return (OPEN_DELIVERY_RUN_STATUSES as readonly string[]).includes(status);
}

/**
 * Decision (approved after Phase 14 Decision Review, Decision 1 = Option B):
 * a "draft" is planning only and reserves nothing — the SAME order may sit
 * in several draft runs at once. An order is reserved against other runs
 * only once a run reaches "active" (i.e. only once `activateRun` has
 * atomically claimed it — see services/deliveryRunService.ts). The
 * model's partial unique index on `stops.orderId` is filtered to exactly
 * this one status, deliberately as a plain equality filter (no `$in`), so
 * it does not carry the `$in`-in-partialFilterExpression MongoDB >= 6.0
 * requirement the old draft-or-active version did.
 */
export const RESERVING_DELIVERY_RUN_STATUS: DeliveryRunStatus = "active";

// ---------------------------------------------------------------- DeliveryStop status

/** Every non-pending stop status is terminal: a resolved stop is never moved back into the pending sequence. */
export const DELIVERY_STOP_TRANSITIONS: Record<DeliveryStopStatus, readonly DeliveryStopStatus[]> = {
  pending: ["delivered", "failed", "skipped"],
  delivered: [],
  failed: [],
  skipped: [],
};

export function canTransitionDeliveryStop(from: DeliveryStopStatus, to: DeliveryStopStatus): boolean {
  return DELIVERY_STOP_TRANSITIONS[from].includes(to);
}

// ---------------------------------------------------------------- Stops & sequence

export interface DeliveryStopLike {
  id: string;
  orderId: string;
  sequence: number;
  status: DeliveryStopStatus;
}

/**
 * `sequence` is the authoritative order: a run with n stops has exactly the
 * sequences 1..n, each once, and each order appears in at most one stop.
 * Array position is never the source of truth.
 */
export function validateStopSet(stops: ReadonlyArray<Pick<DeliveryStopLike, "orderId" | "sequence">>): RuleResult<true> {
  const orderIds = new Set<string>();
  for (const stop of stops) {
    if (orderIds.has(stop.orderId)) {
      return fail("DUPLICATE_ORDER", "یک سفارش را نمی‌توان بیش از یک‌بار در یک ماموریت قرار داد");
    }
    orderIds.add(stop.orderId);
  }
  const sorted = stops.map((s) => s.sequence).sort((a, b) => a - b);
  if (!sorted.every((seq, i) => seq === i + 1)) {
    return fail("INVALID_SEQUENCE", "ترتیب توقف‌ها باید دقیقاً ۱ تا n و بدون تکرار باشد");
  }
  return { ok: true, value: true };
}

/**
 * Builds the initial stops for a new run, one per order, sequence 1..n in
 * the given order. Two orders for the same address are still two stops —
 * this function knows nothing about addresses on purpose.
 */
export function buildInitialStops(orderIds: readonly string[]): RuleResult<Array<{ orderId: string; sequence: number }>> {
  if (orderIds.length === 0) return fail("EMPTY_RUN", "ماموریت باید حداقل یک سفارش داشته باشد");
  const stops = orderIds.map((orderId, i) => ({ orderId, sequence: i + 1 }));
  const check = validateStopSet(stops);
  if (!check.ok) return check;
  return { ok: true, value: stops };
}

/**
 * Computes the new sequences after a courier reorders the pending stops.
 *
 * `orderedPendingStopIds` must be exactly the current pending stops (each
 * once) in the desired order. Locked (non-pending) stops keep their
 * sequence untouched; the pending stops are redistributed over the slots
 * the pending stops already occupy, in ascending slot order. The result is
 * therefore always a permutation of the existing sequence set, so the
 * 1..n invariant holds by construction, and the outcome is deterministic.
 */
export function computeReorderedSequences(
  stops: readonly DeliveryStopLike[],
  orderedPendingStopIds: readonly string[],
): RuleResult<Array<{ stopId: string; sequence: number }>> {
  const byId = new Map(stops.map((s) => [s.id, s]));
  const seen = new Set<string>();
  for (const id of orderedPendingStopIds) {
    const stop = byId.get(id);
    if (!stop) return fail("REORDER_UNKNOWN_STOP", "توقف نامعتبر است");
    if (stop.status !== "pending") {
      return fail("REORDER_NOT_PENDING", "فقط توقف‌های در انتظار قابل جابه‌جایی هستند");
    }
    if (seen.has(id)) return fail("REORDER_INCOMPLETE", "توقف تکراری در ترتیب جدید");
    seen.add(id);
  }
  const pending = stops.filter((s) => s.status === "pending");
  if (pending.length !== seen.size) {
    return fail("REORDER_INCOMPLETE", "ترتیب جدید باید همه‌ی توقف‌های در انتظار را شامل شود");
  }
  const slots = pending.map((s) => s.sequence).sort((a, b) => a - b);
  return { ok: true, value: orderedPendingStopIds.map((stopId, i) => ({ stopId, sequence: slots[i]! })) };
}

/** The stop the courier should go to now: active run → lowest sequence → first pending. Never persisted. */
export function getCurrentStop<T extends DeliveryStopLike>(run: { status: DeliveryRunStatus; stops: readonly T[] }): T | null {
  if (run.status !== "active") return null;
  const pending = run.stops.filter((s) => s.status === "pending").sort((a, b) => a.sequence - b.sequence);
  return pending[0] ?? null;
}

export function hasPendingStops(stops: ReadonlyArray<Pick<DeliveryStopLike, "status">>): boolean {
  return stops.some((s) => s.status === "pending");
}

// ---------------------------------------------------------------- Order.delivery (existing lifecycle)

/**
 * The EXISTING per-order delivery machine (docs/domain-model.md §4), encoded
 * so DeliveryRun code can never advance an order in a way the lifecycle does
 * not allow. Not a new lifecycle: the states are `ORDER_DELIVERY_STATUSES`.
 * "assigned → unassigned" is the release of an assignment that was never
 * picked up (run cancelled).
 *
 * "assigned" and "picked_up" are deliberately distinct states, not
 * paperwork vs. the same event (Phase 14 Decision Review, Decision 2 —
 * approved): "assigned" is official assignment by admin activation
 * (`assignedAt`, Decision 1); "picked_up" is the courier's confirmed
 * physical custody of the goods (`pickedUpAt`, always an explicit courier
 * action — see `confirmPickup` in services/deliveryRunService.ts, never
 * implied by any other operation). "picked_up → proposed" — not
 * "assigned → proposed" — is deliberately the only path to a proposal.
 */
export const ORDER_DELIVERY_TRANSITIONS: Record<OrderDeliveryStatus, readonly OrderDeliveryStatus[]> = {
  unassigned: ["assigned"],
  assigned: ["unassigned", "picked_up"],
  picked_up: ["proposed"],
  proposed: ["resolved"],
  resolved: [],
};

type Actor = "admin" | "courier";

/** Who may trigger each transition. Only an admin can reach "resolved" — a courier can go no further than "proposed". */
const ORDER_DELIVERY_ACTORS: Record<string, Actor> = {
  "unassigned>assigned": "admin",
  "assigned>unassigned": "admin",
  "assigned>picked_up": "courier",
  "picked_up>proposed": "courier",
  "proposed>resolved": "admin",
};

function actorOf(role: UserRole): Actor | null {
  if (role === "admin" || role === "master_admin") return "admin";
  if (role === "courier") return "courier";
  return null;
}

export function canActorTransitionOrderDelivery(from: OrderDeliveryStatus, to: OrderDeliveryStatus, role: UserRole): boolean {
  if (!ORDER_DELIVERY_TRANSITIONS[from].includes(to)) return false;
  const actor = actorOf(role);
  return actor !== null && ORDER_DELIVERY_ACTORS[`${from}>${to}`] === actor;
}

/**
 * A stop outcome is the courier's PROPOSAL on the order, mapped onto the
 * existing proposed outcomes. A failed delivery can only be proposed as
 * "returned" — `delivered | returned` are the only outcomes the approved
 * order lifecycle has.
 */
export function stopOutcomeToProposedOutcome(outcome: "delivered" | "failed"): OrderDeliveryProposedOutcome {
  return outcome === "delivered" ? "delivered" : "returned";
}
