import { BadRequestException } from '@nestjs/common';
import {
  buildLayout, expandZones, MAX_FLOORS, MAX_ZONES_PER_FLOOR,
  parseZoneId, removedZoneIds, zoneExists, zoneId,
} from './layout';

describe('TASK-1 — schematic layout (floors × zones)', () => {
  describe('buildLayout', () => {
    it('fills Hebrew default labels for both axes', () => {
      const layout = buildLayout({ floors: 2, zonesPerFloor: 3 });

      expect(layout.floorNames).toEqual(['קומה 1', 'קומה 2']);
      expect(layout.zoneNames).toEqual(['אגף 1', 'אגף 2', 'אגף 3']);
    });

    it('keeps the names the user typed in the wizard', () => {
      const layout = buildLayout({
        floors: 1,
        zonesPerFloor: 2,
        zoneNames: [' מזרח ', 'מערב'],
        floorNames: ['קרקע'],
      });

      expect(layout.zoneNames).toEqual(['מזרח', 'מערב']);
      expect(layout.floorNames).toEqual(['קרקע']);
    });

    it('falls back to the default for a blank name rather than saving an empty label', () => {
      expect(buildLayout({ floors: 1, zonesPerFloor: 2, zoneNames: ['מזרח', '   '] }).zoneNames)
        .toEqual(['מזרח', 'אגף 2']);
    });

    it.each([
      ['zero floors', { floors: 0, zonesPerFloor: 2 }],
      ['a fractional floor count', { floors: 2.5, zonesPerFloor: 2 }],
      ['more floors than the cap', { floors: MAX_FLOORS + 1, zonesPerFloor: 2 }],
      ['zero zones', { floors: 2, zonesPerFloor: 0 }],
      ['more zones than the cap', { floors: 2, zonesPerFloor: MAX_ZONES_PER_FLOOR + 1 }],
    ])('rejects %s', (_case, input) => {
      expect(() => buildLayout(input)).toThrow(BadRequestException);
    });

    it('rejects a name list whose length disagrees with the chosen count', () => {
      expect(() => buildLayout({ floors: 3, zonesPerFloor: 2, zoneNames: ['א'] }))
        .toThrow(BadRequestException);
    });

    it('rejects duplicate zone names — two "אגף מזרח" on one floor are not addressable', () => {
      expect(() => buildLayout({ floors: 1, zonesPerFloor: 2, zoneNames: ['מזרח', 'מזרח'] }))
        .toThrow(BadRequestException);
    });
  });

  describe('expandZones — the acceptance criterion of TASK-1', () => {
    it.each([[1, 1], [3, 4], [12, 6], [MAX_FLOORS, MAX_ZONES_PER_FLOOR]])(
      '%i floors × %i zones produce exactly F×Z distinct zones',
      (floors, zonesPerFloor) => {
        const zones = expandZones(buildLayout({ floors, zonesPerFloor }));

        expect(zones).toHaveLength(floors * zonesPerFloor);
        expect(new Set(zones.map((z) => z.id)).size).toBe(floors * zonesPerFloor);
      },
    );

    it('orders zones floor-ascending then zone-ascending, so the render order is stable', () => {
      const zones = expandZones(buildLayout({ floors: 2, zonesPerFloor: 2 }));

      expect(zones.map((z) => z.id)).toEqual([
        'floor-1/zone-1', 'floor-1/zone-2', 'floor-2/zone-1', 'floor-2/zone-2',
      ]);
    });

    it('labels each zone with both axes, for the Twin zone panel', () => {
      const [first] = expandZones(
        buildLayout({ floors: 1, zonesPerFloor: 1, zoneNames: ['מזרח'], floorNames: ['קרקע'] }),
      );

      expect(first).toMatchObject({
        id: 'floor-1/zone-1', floor: 1, zone: 1, label: 'קרקע · מזרח',
      });
    });

    it('changes only in data when the layout grows — no code path per size', () => {
      const before = expandZones(buildLayout({ floors: 2, zonesPerFloor: 2 }));
      const after = expandZones(buildLayout({ floors: 3, zonesPerFloor: 2 }));

      expect(after).toHaveLength(6);
      expect(after.slice(0, before.length)).toEqual(before);
    });
  });

  describe('zone identity', () => {
    it('round-trips through parseZoneId', () => {
      expect(parseZoneId(zoneId(7, 2))).toEqual({ floor: 7, zone: 2 });
    });

    it('returns null for anything this scheme did not produce', () => {
      expect(parseZoneId('floor-3/east')).toBeNull();
      expect(parseZoneId('')).toBeNull();
    });

    it('knows which zones a layout contains', () => {
      const layout = buildLayout({ floors: 2, zonesPerFloor: 2 });

      expect(zoneExists(layout, 'floor-2/zone-2')).toBe(true);
      expect(zoneExists(layout, 'floor-3/zone-1')).toBe(false);
      expect(zoneExists(null, 'floor-1/zone-1')).toBe(false);
    });
  });

  describe('removedZoneIds — what a layout edit would delete', () => {
    it('is empty when the building grows', () => {
      const before = buildLayout({ floors: 2, zonesPerFloor: 2 });
      const after = buildLayout({ floors: 4, zonesPerFloor: 3 });

      expect(removedZoneIds(before, after)).toEqual([]);
    });

    it('names every cell that disappears when the building shrinks', () => {
      const before = buildLayout({ floors: 2, zonesPerFloor: 2 });
      const after = buildLayout({ floors: 1, zonesPerFloor: 2 });

      expect(removedZoneIds(before, after)).toEqual(['floor-2/zone-1', 'floor-2/zone-2']);
    });

    it('treats a project that never had a layout as removing nothing', () => {
      expect(removedZoneIds(null, buildLayout({ floors: 1, zonesPerFloor: 1 }))).toEqual([]);
    });
  });
});
