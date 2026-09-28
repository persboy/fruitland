import type { Coordinates, RouteResult, VehicleType } from "@fruitland/shared";
import type { MapService } from "../maps/service";

/**
 * The boundary between the delivery domain and the map layer:
 *
 *   Delivery domain → DeliveryRoutePlanner → MapService → MapProvider
 *
 * The delivery domain decides WHICH stops belong to a run and in WHAT order
 * (`DeliveryRun.stops[].sequence`); MapService only answers "how do I get
 * from A to B" and knows nothing about runs. This file must never import a
 * concrete map provider or map a vehicle type to a provider parameter — the
 * domain `VehicleType` is passed through untouched and each provider
 * adapter does its own mapping (an unsupported vehicle surfaces as the
 * adapter's UNSUPPORTED_OPERATION error).
 *
 * Phase 14 scope: the interface and a plain sequential planner. No
 * optimisation, no reordering — a future planner (e.g. one using
 * `MapService.getRouteMatrix`) implements the same interface. Route
 * geometry / distance / ETA are computed on demand and are NOT persisted.
 */
export interface RoutePlanStop {
  stopId: string;
  orderId: string;
  coordinates: Coordinates;
}

export interface DeliveryRoutePlanInput {
  vehicleType: VehicleType;
  /** Where the courier starts (store or current location — the caller's choice). */
  origin: Coordinates;
  /** Stops in the order to be visited. A planner that optimises would return a different order. */
  stops: readonly RoutePlanStop[];
}

export interface PlannedLeg {
  /** null for the first leg (from the origin). */
  fromStopId: string | null;
  toStopId: string;
  route: RouteResult;
}

export interface DeliveryRoutePlan {
  vehicleType: VehicleType;
  legs: PlannedLeg[];
}

export interface DeliveryRoutePlanner {
  plan(input: DeliveryRoutePlanInput): Promise<DeliveryRoutePlan>;
}

/** Routes origin → stop 1 → stop 2 → … exactly in the given order, one MapService.getRoute call per leg. */
export class SequentialRoutePlanner implements DeliveryRoutePlanner {
  constructor(private readonly maps: Pick<MapService, "getRoute">) {}

  async plan(input: DeliveryRoutePlanInput): Promise<DeliveryRoutePlan> {
    const legs: PlannedLeg[] = [];
    let previous: { stopId: string | null; coordinates: Coordinates } = { stopId: null, coordinates: input.origin };
    for (const stop of input.stops) {
      const route = await this.maps.getRoute(previous.coordinates, stop.coordinates, { vehicleType: input.vehicleType });
      legs.push({ fromStopId: previous.stopId, toStopId: stop.stopId, route });
      previous = { stopId: stop.stopId, coordinates: stop.coordinates };
    }
    return { vehicleType: input.vehicleType, legs };
  }
}

interface StopForPlan {
  id: string;
  orderId: string;
  sequence: number;
  status: string;
}

/**
 * Builds planner input from a run's pending stops, in `sequence` order.
 * Destinations come from each order's `deliveryAddress.location` snapshot
 * (stored `{lat,lng}`), converted to the shared `Coordinates` shape. An
 * order without a stored location is reported, not silently skipped or
 * guessed. Two stops with identical coordinates stay two separate stops.
 */
export function buildRoutePlanInput(params: {
  vehicleType: VehicleType;
  origin: Coordinates;
  stops: readonly StopForPlan[];
  orderLocations: ReadonlyMap<string, { lat: number; lng: number } | undefined>;
}): { input: DeliveryRoutePlanInput; missingLocationOrderIds: string[] } {
  const missing: string[] = [];
  const planStops: RoutePlanStop[] = [];
  const pending = params.stops.filter((s) => s.status === "pending").sort((a, b) => a.sequence - b.sequence);
  for (const stop of pending) {
    const location = params.orderLocations.get(stop.orderId);
    if (!location) {
      missing.push(stop.orderId);
      continue;
    }
    planStops.push({ stopId: stop.id, orderId: stop.orderId, coordinates: { latitude: location.lat, longitude: location.lng } });
  }
  return { input: { vehicleType: params.vehicleType, origin: params.origin, stops: planStops }, missingLocationOrderIds: missing };
}
