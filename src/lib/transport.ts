import { data, type Item, type Station, type Transport, transportFor } from './data';

/** How an item gets between a factory and the rest of the base. */
export type Carrier = 'line' | 'train' | 'truck' | 'tractor' | 'explorer' | 'fluidTruck' | 'drone';

export const CARRIERS: Carrier[] = ['line', 'train', 'truck', 'tractor', 'explorer', 'fluidTruck', 'drone'];

// Not in the game files. Measured in game and written up on the official wiki (satisfactory.wiki.gg):
/** Top speeds in m/s, on flat ground: Electric Locomotive 120 km/h, Truck and Fluid Truck 89, Tractor 69, Explorer 107. */
const SPEED: Record<Exclude<Carrier, 'line'>, number> = {
  train: 120 / 3.6,
  truck: 89 / 3.6,
  fluidTruck: 89 / 3.6,
  tractor: 69 / 3.6,
  explorer: 107 / 3.6,
  // On batteries (Drone page: 75 m/s; packaged fuel 50, turbofuel 60).
  drone: 75,
};
/** A train speeds up and slows down at about 1 m/s² (Electric Locomotive page). */
const TRAIN_ACCELERATION = 1;
/** A freight platform locks a car for 27.08 s per stop, the load animation (Tutorial:Train throughput). */
const PLATFORM_LOCK = 27.08;
/** What one fluid freight car holds since 1.2, in m³ (Freight Car page). */
const FLUID_CAR = 2400;
/** Rule of thumb on the wiki: one locomotive per four cars. */
const CARS_PER_LOCOMOTIVE = 4;
/** A drone's take-off and landing take 51 s each (Drone page). */
const DRONE_DOCK = 51;
/** One fluid stack: 50,000 litres in the game files, 50 m³. */
const FLUID_STACK = 50;

const VEHICLE: Record<Exclude<Carrier, 'line'>, string> = {
  train: 'Desc_FreightWagon_C',
  truck: 'Desc_Truck_C',
  fluidTruck: 'Desc_FluidTruck_C',
  tractor: 'Desc_Tractor_C',
  explorer: 'Desc_Explorer_C',
  drone: 'Desc_DroneTransport_C',
};

const vehicle = (id: string) => data.vehicles.find((v) => v.id === id)!;
const station = (id: string) => data.stations.find((s) => s.id === id)!;
const fluidOf = (item: Item) => item.form !== 'solid';

/** Tier a carrier unlocks at; belts and pipes are there from the start. */
export function carrierTier(carrier: Carrier): number {
  if (carrier === 'line') return 0;
  const own = vehicle(VEHICLE[carrier]).tier;
  return carrier === 'train' ? Math.max(own, vehicle('Desc_Locomotive_C').tier) : own;
}

/** Whether a carrier can take this item at all: drones and the dry vehicles carry solids, the fluid truck fluids. */
export function carries(carrier: Carrier, item: Item): boolean {
  if (carrier === 'line' || carrier === 'train') return true;
  return vehicle(VEHICLE[carrier]).fluid === fluidOf(item);
}

/** Carriers that take this item and are unlocked at the tier, belts or pipes first. */
export const carriersFor = (item: Item, tier = 99) => CARRIERS.filter((c) => carries(c, item) && carrierTier(c) <= tier);

export interface Haul {
  carrier: Carrier;
  /** Belts or pipes: which one, and how many side by side. */
  line?: { transport: Transport; lanes: number };
  /** Vehicles needed: freight cars for a train. */
  vehicles: number;
  locomotives?: number;
  /** Stations at both ends together. */
  stations: { station: Station; count: number }[];
  /** Seconds there and back, stops included. */
  roundTrip?: number;
  /** What one vehicle moves a minute at most. */
  perVehicle?: number;
  /** MW of electricity: locomotives at full draw, stations, platforms and ports. */
  power: number;
  /** Road vehicles: MW of fuel burnt on average while they cover the route. */
  fuel?: number;
  /** Drones: batteries a minute, and per round trip. */
  batteries?: { perMinute: number; perTrip: number };
  /** Rests on speeds measured on flat ground, so it's an estimate. */
  estimate: boolean;
}

/** How much one vehicle holds: slots × stack for solids; m³ for fluids. */
export function capacity(carrier: Exclude<Carrier, 'line'>, item: Item): number {
  if (carrier === 'train') return fluidOf(item) ? FLUID_CAR : 32 * (item.stack ?? 1);
  if (carrier === 'fluidTruck') return (station('Build_FluidTruckStation_C').fluidStacks ?? 64) * FLUID_STACK;
  return vehicle(VEHICLE[carrier]).slots * (item.stack ?? 1);
}

/** Seconds a train takes one way: up to speed and back down at the far end, or less on a short run. */
function trainLeg(distance: number): number {
  const v = SPEED.train;
  const ramp = (v * v) / TRAIN_ACCELERATION;
  return distance >= ramp ? distance / v + v / TRAIN_ACCELERATION : 2 * Math.sqrt(distance / TRAIN_ACCELERATION);
}

/**
 * What one freight car moves a minute (Tutorial:Train throughput on the wiki): it takes hold / feed + 27.08 s to
 * fill from the platform's inputs. A round trip at least that long moves a full car each time; a shorter one moves
 * what the inputs bring in while the platform isn't locked.
 */
export function carRate(hold: number, feed: number, roundTrip: number): number {
  const trip = roundTrip / 60;
  const lock = PLATFORM_LOCK / 60;
  const fill = hold / feed + lock;
  return trip >= fill ? hold / trip : ((trip - lock) / trip) * feed;
}

/**
 * How to move `rate` a minute of an item `distance` metres one way, with the best belt or pipe unlocked at the
 * tier feeding each freight platform's two inputs.
 */
export function haul(item: Item, rate: number, carrier: Carrier, distance: number, tier = 99): Haul {
  const need = Math.max(0, rate);
  const d = Math.max(0, distance);
  if (carrier === 'line') {
    return { carrier, line: transportFor(item, need, tier), vehicles: 0, stations: [], power: 0, estimate: false };
  }
  const hold = capacity(carrier, item);
  const loads = need / hold;

  if (carrier === 'train') {
    const lines = fluidOf(item) ? data.pipes : data.belts;
    const best = transportFor(item, Number.POSITIVE_INFINITY, tier).transport ?? lines[0];
    const feed = 2 * best.rate;
    const roundTrip = 2 * trainLeg(d) + 2 * PLATFORM_LOCK;
    const perVehicle = carRate(hold, feed, roundTrip);
    const cars = need > 0 ? Math.ceil(need / perVehicle - 1e-9) : 0;
    const locomotives = Math.ceil(cars / CARS_PER_LOCOMOTIVE);
    const platform = station(fluidOf(item) ? 'Build_TrainDockingStationLiquid_C' : 'Build_TrainDockingStation_C');
    const stop = station('Build_TrainStation_C');
    const stations =
      cars > 0
        ? [
            { station: stop, count: 2 },
            { station: platform, count: 2 * cars },
          ]
        : [];
    const loco = vehicle('Desc_Locomotive_C').powerRange?.[1] ?? 110;
    const power = locomotives * loco + stations.reduce((s, x) => s + x.count * x.station.power, 0);
    return { carrier, vehicles: cars, locomotives, stations, roundTrip, perVehicle, power, estimate: true };
  }

  if (carrier === 'drone') {
    const port = station('Build_DroneStation_C');
    const flying = (2 * d) / SPEED.drone;
    const roundTrip = 2 * DRONE_DOCK + flying;
    const perVehicle = hold / (roundTrip / 60);
    const drones = need > 0 ? Math.ceil(need / perVehicle - 1e-9) : 0;
    // A port holds one drone; the far end is busy for a landing and a take-off each delivery.
    const far = drones > 0 ? Math.max(1, Math.ceil((loads * 2 * DRONE_DOCK) / 60 - 1e-9)) : 0;
    const ports = drones + far;
    const trip = port.trip ?? { base: 24000, perMetre: 6, battery: 6000 };
    const perTrip = (trip.base + trip.perMetre * 2 * d) / trip.battery;
    return {
      carrier,
      vehicles: drones,
      stations: ports > 0 ? [{ station: port, count: ports }] : [],
      roundTrip,
      perVehicle,
      power: ports * port.power,
      batteries: { perMinute: loads * perTrip, perTrip },
      estimate: true,
    };
  }

  const stop = station(carrier === 'fluidTruck' ? 'Build_FluidTruckStation_C' : 'Build_TruckStation_C');
  const driving = (2 * d) / SPEED[carrier];
  const roundTrip = driving + 2 * stop.load;
  const perVehicle = hold / (roundTrip / 60);
  const count = need > 0 ? Math.ceil(need / perVehicle - 1e-9) : 0;
  // One vehicle docks at a time, for `load` seconds; busy routes need more than one station at each end.
  const perEnd = count > 0 ? Math.max(1, Math.ceil((loads * stop.load) / 60 - 1e-9)) : 0;
  const fuel = ((vehicle(VEHICLE[carrier]).fuelPower ?? 0) * driving * loads) / 60;
  return {
    carrier,
    vehicles: count,
    stations: perEnd > 0 ? [{ station: stop, count: 2 * perEnd }] : [],
    roundTrip,
    perVehicle,
    power: 2 * perEnd * stop.power,
    fuel,
    estimate: true,
  };
}

/** Each vehicle as the Codex lists it: what it holds, how fast it goes, how long a stop takes, when it unlocks. */
export function vehicleFacts() {
  return (['train', 'truck', 'fluidTruck', 'tractor', 'explorer', 'drone'] as const).map((carrier) => {
    const v = vehicle(VEHICLE[carrier]);
    const stop =
      carrier === 'train'
        ? PLATFORM_LOCK
        : carrier === 'drone'
          ? DRONE_DOCK
          : station(carrier === 'fluidTruck' ? 'Build_FluidTruckStation_C' : 'Build_TruckStation_C').load;
    return {
      carrier,
      id: carrier === 'train' ? 'Desc_FreightWagon_C' : v.id,
      slots: v.slots,
      /** m³ for the fluid truck; a freight car holds this much fluid instead of its slots. */
      fluid: carrier === 'fluidTruck' ? capacity('fluidTruck', data.items.Desc_Water_C) : carrier === 'train' ? FLUID_CAR : undefined,
      speed: SPEED[carrier] * 3.6,
      stop,
      tier: carrierTier(carrier),
    };
  });
}
