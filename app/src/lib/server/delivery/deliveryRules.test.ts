import { describe, expect, it } from "vitest";
import {
  ORDER_DELIVERY_STATUSES,
  USER_ROLES,
  buildInitialStops,
  canActorTransitionOrderDelivery,
  canTransitionDeliveryRun,
  canTransitionDeliveryStop,
  canTransitionEmergencyCancelRequest,
  computeReorderedSequences,
  getCurrentStop,
  isOpenDeliveryRunStatus,
  stopOutcomeToProposedOutcome,
  validateStopSet,
  type DeliveryStopLike,
} from "@fruitland/shared";

const stop = (id: string, sequence: number, status: DeliveryStopLike["status"] = "pending"): DeliveryStopLike => ({
  id,
  orderId: `order-${id}`,
  sequence,
  status,
});

describe("DeliveryRun status machine", () => {
  it("only allows draft→active/cancelled and active→completed/cancelled", () => {
    expect(canTransitionDeliveryRun("draft", "active")).toBe(true);
    expect(canTransitionDeliveryRun("draft", "cancelled")).toBe(true);
    expect(canTransitionDeliveryRun("active", "completed")).toBe(true);
    expect(canTransitionDeliveryRun("active", "cancelled")).toBe(true);
    expect(canTransitionDeliveryRun("draft", "completed")).toBe(false);
    expect(canTransitionDeliveryRun("completed", "active")).toBe(false);
    expect(canTransitionDeliveryRun("cancelled", "active")).toBe(false);
  });

  it("treats only draft and active runs as holding their orders", () => {
    expect(isOpenDeliveryRunStatus("draft")).toBe(true);
    expect(isOpenDeliveryRunStatus("active")).toBe(true);
    expect(isOpenDeliveryRunStatus("completed")).toBe(false);
    expect(isOpenDeliveryRunStatus("cancelled")).toBe(false);
  });
});

describe("DeliveryStop status machine", () => {
  it("lets a pending stop reach any terminal status, and never leave a terminal one", () => {
    for (const to of ["delivered", "failed", "skipped"] as const) {
      expect(canTransitionDeliveryStop("pending", to)).toBe(true);
      for (const back of ["pending", "delivered", "failed", "skipped"] as const) {
        expect(canTransitionDeliveryStop(to, back)).toBe(false);
      }
    }
  });
});

describe("stop sequence invariant", () => {
  it("builds sequences 1..n in the given order", () => {
    const result = buildInitialStops(["a", "b", "c"]);
    expect(result).toEqual({
      ok: true,
      value: [
        { orderId: "a", sequence: 1 },
        { orderId: "b", sequence: 2 },
        { orderId: "c", sequence: 3 },
      ],
    });
  });

  it("rejects an empty run and the same order twice in one run", () => {
    expect(buildInitialStops([])).toMatchObject({ ok: false, code: "EMPTY_RUN" });
    expect(buildInitialStops(["a", "b", "a"])).toMatchObject({ ok: false, code: "DUPLICATE_ORDER" });
  });

  it("accepts a valid set regardless of array order (sequence, not position, is authoritative)", () => {
    expect(validateStopSet([{ orderId: "b", sequence: 2 }, { orderId: "a", sequence: 1 }]).ok).toBe(true);
  });

  it("rejects gaps, duplicates and non-1-based sequences", () => {
    expect(validateStopSet([{ orderId: "a", sequence: 1 }, { orderId: "b", sequence: 3 }])).toMatchObject({ ok: false, code: "INVALID_SEQUENCE" });
    expect(validateStopSet([{ orderId: "a", sequence: 1 }, { orderId: "b", sequence: 1 }])).toMatchObject({ ok: false, code: "INVALID_SEQUENCE" });
    expect(validateStopSet([{ orderId: "a", sequence: 0 }, { orderId: "b", sequence: 1 }])).toMatchObject({ ok: false, code: "INVALID_SEQUENCE" });
  });
});

describe("computeReorderedSequences", () => {
  it("permutes pending stops and produces a valid 1..n sequence set", () => {
    const stops = [stop("a", 1), stop("b", 2), stop("c", 3), stop("d", 4)];
    const result = computeReorderedSequences(stops, ["d", "b", "a", "c"]);
    expect(result).toEqual({
      ok: true,
      value: [
        { stopId: "d", sequence: 1 },
        { stopId: "b", sequence: 2 },
        { stopId: "a", sequence: 3 },
        { stopId: "c", sequence: 4 },
      ],
    });
  });

  it("keeps delivered/failed/skipped stops exactly where they are and only redistributes the pending slots", () => {
    const stops = [stop("a", 1, "delivered"), stop("b", 2, "skipped"), stop("c", 3), stop("d", 4), stop("e", 5)];
    const result = computeReorderedSequences(stops, ["e", "c", "d"]);
    expect(result).toEqual({
      ok: true,
      value: [
        { stopId: "e", sequence: 3 },
        { stopId: "c", sequence: 4 },
        { stopId: "d", sequence: 5 },
      ],
    });
    if (!result.ok) return;
    const after = stops.map((s) => ({ ...s, sequence: result.value.find((v) => v.stopId === s.id)?.sequence ?? s.sequence }));
    expect(validateStopSet(after).ok).toBe(true);
    expect(after.find((s) => s.id === "a")?.sequence).toBe(1);
    expect(after.find((s) => s.id === "b")?.sequence).toBe(2);
  });

  it("can never move a locked stop back into the pending sequence", () => {
    const stops = [stop("a", 1, "delivered"), stop("b", 2), stop("c", 3)];
    expect(computeReorderedSequences(stops, ["a", "b", "c"])).toMatchObject({ ok: false, code: "REORDER_NOT_PENDING" });
    expect(computeReorderedSequences(stops, ["c", "b", "a"])).toMatchObject({ ok: false, code: "REORDER_NOT_PENDING" });
  });

  it("requires every pending stop exactly once, and rejects unknown stops", () => {
    const stops = [stop("a", 1), stop("b", 2), stop("c", 3)];
    expect(computeReorderedSequences(stops, ["a", "b"])).toMatchObject({ ok: false, code: "REORDER_INCOMPLETE" });
    expect(computeReorderedSequences(stops, ["a", "b", "b"])).toMatchObject({ ok: false, code: "REORDER_INCOMPLETE" });
    expect(computeReorderedSequences(stops, ["a", "b", "zzz"])).toMatchObject({ ok: false, code: "REORDER_UNKNOWN_STOP" });
  });

  it("is deterministic for the same input", () => {
    const stops = [stop("a", 1), stop("b", 2), stop("c", 3)];
    expect(computeReorderedSequences(stops, ["c", "a", "b"])).toEqual(computeReorderedSequences(stops, ["c", "a", "b"]));
  });
});

describe("getCurrentStop (derived, never persisted)", () => {
  it("is the pending stop with the lowest sequence, regardless of array order", () => {
    const run = { status: "active" as const, stops: [stop("c", 3), stop("a", 1, "delivered"), stop("b", 2), stop("d", 4)] };
    expect(getCurrentStop(run)?.id).toBe("b");
  });

  it("is null for a non-active run or when nothing is pending", () => {
    expect(getCurrentStop({ status: "draft", stops: [stop("a", 1)] })).toBeNull();
    expect(getCurrentStop({ status: "completed", stops: [stop("a", 1)] })).toBeNull();
    expect(getCurrentStop({ status: "active", stops: [stop("a", 1, "delivered")] })).toBeNull();
  });
});

describe("Order.delivery rules as applied by DeliveryRun code", () => {
  it("a courier can pick up and propose, but can never assign or resolve", () => {
    expect(canActorTransitionOrderDelivery("assigned", "picked_up", "courier")).toBe(true);
    expect(canActorTransitionOrderDelivery("picked_up", "proposed", "courier")).toBe(true);
    expect(canActorTransitionOrderDelivery("proposed", "resolved", "courier")).toBe(false);
    expect(canActorTransitionOrderDelivery("unassigned", "assigned", "courier")).toBe(false);
  });

  it("only admin / master_admin can assign and resolve", () => {
    for (const role of ["admin", "master_admin"] as const) {
      expect(canActorTransitionOrderDelivery("unassigned", "assigned", role)).toBe(true);
      expect(canActorTransitionOrderDelivery("proposed", "resolved", role)).toBe(true);
    }
    expect(canActorTransitionOrderDelivery("proposed", "resolved", "customer")).toBe(false);
  });

  it("nobody can reach 'resolved' except through 'proposed', and no role can skip a step", () => {
    for (const role of USER_ROLES) {
      for (const from of ORDER_DELIVERY_STATUSES) {
        if (from !== "proposed") expect(canActorTransitionOrderDelivery(from, "resolved", role)).toBe(false);
      }
      expect(canActorTransitionOrderDelivery("unassigned", "picked_up", role)).toBe(false);
      expect(canActorTransitionOrderDelivery("assigned", "proposed", role)).toBe(false);
    }
  });

  it("a failed stop can only be proposed as 'returned' (the only non-delivered outcome the order lifecycle has)", () => {
    expect(stopOutcomeToProposedOutcome("delivered")).toBe("delivered");
    expect(stopOutcomeToProposedOutcome("failed")).toBe("returned");
  });
});

describe("Emergency Cancel (Phase 14): picked_up -> emergency_cancelled, admin-only", () => {
  it("is reachable only from picked_up, and is terminal", () => {
    expect(canActorTransitionOrderDelivery("picked_up", "emergency_cancelled", "admin")).toBe(true);
    for (const from of ORDER_DELIVERY_STATUSES) {
      if (from !== "picked_up") expect(canActorTransitionOrderDelivery(from, "emergency_cancelled", "admin")).toBe(false);
    }
    for (const to of ORDER_DELIVERY_STATUSES) {
      expect(canActorTransitionOrderDelivery("emergency_cancelled", to, "admin")).toBe(false);
    }
  });

  it("a courier can never cause this transition — only an admin's approval can", () => {
    for (const role of USER_ROLES) {
      if (role === "admin" || role === "master_admin") continue;
      expect(canActorTransitionOrderDelivery("picked_up", "emergency_cancelled", role)).toBe(false);
    }
  });

  it("picked_up still allows the ordinary proposal path too (emergency_cancelled is an alternative, not a replacement)", () => {
    expect(canActorTransitionOrderDelivery("picked_up", "proposed", "courier")).toBe(true);
  });
});

describe("EmergencyCancelRequest status machine", () => {
  it("a pending request may be approved or rejected; both are terminal", () => {
    expect(canTransitionEmergencyCancelRequest("pending", "approved")).toBe(true);
    expect(canTransitionEmergencyCancelRequest("pending", "rejected")).toBe(true);
    expect(canTransitionEmergencyCancelRequest("approved", "pending")).toBe(false);
    expect(canTransitionEmergencyCancelRequest("approved", "rejected")).toBe(false);
    expect(canTransitionEmergencyCancelRequest("rejected", "pending")).toBe(false);
    expect(canTransitionEmergencyCancelRequest("rejected", "approved")).toBe(false);
  });
});
