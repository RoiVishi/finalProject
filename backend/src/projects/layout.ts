import { BadRequestException } from '@nestjs/common';

/**
 * TASK-1, step 2 of the project wizard — the schematic building layout
 * (מסמך האפיון §4.1: "מספר קומות ומספר אגפים בקומה (רשת קומות × אזורים)").
 *
 * The acceptance criterion is a statement about data, not about drawing:
 * "a project with F floors × Z zones renders exactly F×Z clickable Twin zones
 * with no code change". That only holds if the zone list is DERIVED from two
 * numbers rather than written down anywhere — so the layout stores F and Z,
 * and every consumer (TWIN-1, Task.zone, the feature adapter of PRED-9) reads
 * the expansion below. No file in this repository may contain a hard-coded
 * zone name; the previous placeholder ['north','south','east','west'] is
 * exactly the code change the criterion forbids.
 */
export interface ProjectLayout {
  /** F — number of floors, numbered 1..F from the ground up. */
  floors: number;
  /** Z — number of zones (אגפים) on every floor. */
  zonesPerFloor: number;
  /** Display labels, one per zone index. Length is always Z. */
  zoneNames: string[];
  /** Display labels, one per floor index. Length is always F. */
  floorNames: string[];
}

/** One clickable cell of the Digital Twin (TWIN-1). */
export interface TwinZone {
  /** Stable identity, e.g. "floor-3/zone-2". This is what Task.zone stores. */
  id: string;
  floor: number;
  zone: number;
  floorLabel: string;
  zoneLabel: string;
  /** Human label for the zone panel, e.g. "קומה 3 · אגף מזרח". */
  label: string;
}

/**
 * Sanity caps, not a modelling opinion: they bound the F×Z expansion that the
 * Twin renders and the number of rows a layout edit can touch. A tower taller
 * than this is out of scope for the graded product (Requirements §1).
 */
export const MAX_FLOORS = 80;
export const MAX_ZONES_PER_FLOOR = 20;

export interface LayoutInput {
  floors: number;
  zonesPerFloor: number;
  zoneNames?: string[];
  floorNames?: string[];
}

const defaultFloorName = (floor: number) => `קומה ${floor}`;
const defaultZoneName = (zone: number) => `אגף ${zone}`;

function normalizeNames(
  names: string[] | undefined,
  expected: number,
  fallback: (index: number) => string,
  what: string,
): string[] {
  if (!names) return Array.from({ length: expected }, (_, i) => fallback(i + 1));

  if (names.length !== expected) {
    throw new BadRequestException(
      `מספר השמות ל${what} (${names.length}) אינו תואם למספר שנבחר (${expected})`,
    );
  }

  const trimmed = names.map((n, i) => (typeof n === 'string' ? n.trim() : '') || fallback(i + 1));
  const unique = new Set(trimmed.map((n) => n.toLowerCase()));
  if (unique.size !== trimmed.length) {
    throw new BadRequestException(`שמות ה${what} חייבים להיות ייחודיים`);
  }
  return trimmed;
}

/**
 * Validates the wizard's step-2 input and materialises the labels, so that a
 * project row is self-describing: reading it never requires re-deriving the
 * defaults that were in force on the day it was created.
 */
export function buildLayout(input: LayoutInput): ProjectLayout {
  const { floors, zonesPerFloor } = input;

  if (!Number.isInteger(floors) || floors < 1 || floors > MAX_FLOORS) {
    throw new BadRequestException(`מספר הקומות חייב להיות מספר שלם בין 1 ל-${MAX_FLOORS}`);
  }
  if (
    !Number.isInteger(zonesPerFloor)
    || zonesPerFloor < 1
    || zonesPerFloor > MAX_ZONES_PER_FLOOR
  ) {
    throw new BadRequestException(
      `מספר האגפים בקומה חייב להיות מספר שלם בין 1 ל-${MAX_ZONES_PER_FLOOR}`,
    );
  }

  return {
    floors,
    zonesPerFloor,
    zoneNames: normalizeNames(input.zoneNames, zonesPerFloor, defaultZoneName, 'אגפים'),
    floorNames: normalizeNames(input.floorNames, floors, defaultFloorName, 'קומות'),
  };
}

export const zoneId = (floor: number, zone: number) => `floor-${floor}/zone-${zone}`;

/** Inverse of zoneId. Returns null for anything this layout scheme did not produce. */
export function parseZoneId(id: string): { floor: number; zone: number } | null {
  const m = /^floor-(\d+)\/zone-(\d+)$/.exec(id ?? '');
  if (!m) return null;
  return { floor: Number(m[1]), zone: Number(m[2]) };
}

/**
 * The F×Z expansion the Twin renders. Ordered floor-ascending, zone-ascending,
 * so the same layout always produces the same sequence — screenshots, tests and
 * the feature adapter can rely on the order.
 */
export function expandZones(layout: ProjectLayout): TwinZone[] {
  const zones: TwinZone[] = [];
  for (let floor = 1; floor <= layout.floors; floor += 1) {
    const floorLabel = layout.floorNames[floor - 1] ?? defaultFloorName(floor);
    for (let zone = 1; zone <= layout.zonesPerFloor; zone += 1) {
      const zoneLabel = layout.zoneNames[zone - 1] ?? defaultZoneName(zone);
      zones.push({
        id: zoneId(floor, zone),
        floor,
        zone,
        floorLabel,
        zoneLabel,
        label: `${floorLabel} · ${zoneLabel}`,
      });
    }
  }
  return zones;
}

/** Does this layout contain the zone an activity claims to sit in (TASK-2)? */
export function zoneExists(layout: ProjectLayout | null, id: string): boolean {
  const parsed = parseZoneId(id);
  if (!layout || !parsed) return false;
  return (
    parsed.floor >= 1
    && parsed.floor <= layout.floors
    && parsed.zone >= 1
    && parsed.zone <= layout.zonesPerFloor
  );
}

/**
 * Zone ids that exist in `before` and not in `after` — i.e. the cells an edit
 * would delete. Shrinking a building is the one layout edit that can orphan
 * activities, so the service checks this list against the tasks table before
 * saving (and never silently drops the reference).
 */
export function removedZoneIds(before: ProjectLayout | null, after: ProjectLayout): string[] {
  if (!before) return [];
  const survives = new Set(expandZones(after).map((z) => z.id));
  return expandZones(before)
    .map((z) => z.id)
    .filter((id) => !survives.has(id));
}
