import { cityBlockGroundSpec, generateCityBlock, type CityBlockLayout } from '@zephyr3d/procgen';

const FRONT = 2;
const REAR = 6;
const CELL = 18;

function mod(value: number, m: number): number {
  return ((value % m) + m) % m;
}

/** Recovers the cell span a parcel was carved from, plus its four edge gaps. */
function parcelGeometry(layout: CityBlockLayout, parcel: CityBlockLayout['parcels'][number]) {
  const { cellSize, origin } = layout;
  const gapMinX = mod(parcel.x - origin[0], cellSize);
  const gapMinZ = mod(parcel.z - origin[1], cellSize);
  const gapMaxX = cellSize - mod(parcel.x + parcel.width - origin[0], cellSize);
  const gapMaxZ = cellSize - mod(parcel.z + parcel.depth - origin[1], cellSize);
  const x0 = Math.round((parcel.x - gapMinX - origin[0]) / cellSize);
  const z0 = Math.round((parcel.z - gapMinZ - origin[1]) / cellSize);
  const spanX = Math.round((parcel.width + gapMinX + gapMaxX) / cellSize);
  const spanZ = Math.round((parcel.depth + gapMinZ + gapMaxZ) / cellSize);
  return { gapMinX, gapMaxX, gapMinZ, gapMaxZ, x0, z0, spanX, spanZ };
}

describe('procgen / street frontage', () => {
  const layouts: CityBlockLayout[] = [];
  for (let seed = 0; seed < 10; seed++) {
    layouts.push(
      generateCityBlock({
        width: 8,
        height: 7,
        seed,
        cellSize: CELL,
        frontSetback: FRONT,
        rearSetback: REAR
      })
    );
  }

  it('marks exactly the sides that touch a carriageway', () => {
    for (const layout of layouts) {
      for (const parcel of layout.parcels) {
        const { x0, z0, spanX, spanZ } = parcelGeometry(layout, parcel);
        const isRoad = (x: number, z: number) =>
          x >= 0 && z >= 0 && x < layout.width && z < layout.height && layout.kinds[z][x] === 'road';

        let expectPlusX = false;
        let expectMinusX = false;
        for (let dz = 0; dz < spanZ; dz++) {
          expectPlusX ||= isRoad(x0 + spanX, z0 + dz);
          expectMinusX ||= isRoad(x0 - 1, z0 + dz);
        }
        let expectPlusZ = false;
        let expectMinusZ = false;
        for (let dx = 0; dx < spanX; dx++) {
          expectPlusZ ||= isRoad(x0 + dx, z0 + spanZ);
          expectMinusZ ||= isRoad(x0 + dx, z0 - 1);
        }
        expect(parcel.frontage).toEqual([expectPlusX, expectMinusX, expectPlusZ, expectMinusZ]);
      }
    }
  });

  it('keeps frontageMask in step with frontage', () => {
    for (const layout of layouts) {
      for (const parcel of layout.parcels) {
        const expected = parcel.frontage.reduce((mask, on, index) => mask | (on ? 1 << index : 0), 0);
        expect(parcel.frontageMask).toBe(expected);
      }
    }
  });

  it('pulls buildings up to the street and pushes the slack to the rear', () => {
    let fronting = 0;
    let rear = 0;
    for (const layout of layouts) {
      for (const parcel of layout.parcels) {
        const gaps = parcelGeometry(layout, parcel);
        const anyFrontage = parcel.frontage.some(Boolean);
        const expected = (side: boolean) => (anyFrontage ? (side ? FRONT : REAR) : FRONT);
        expect(gaps.gapMaxX).toBeNear(expected(parcel.frontage[0]), 1e-6);
        expect(gaps.gapMinX).toBeNear(expected(parcel.frontage[1]), 1e-6);
        expect(gaps.gapMaxZ).toBeNear(expected(parcel.frontage[2]), 1e-6);
        expect(gaps.gapMinZ).toBeNear(expected(parcel.frontage[3]), 1e-6);
        for (const side of parcel.frontage) {
          if (side) {
            fronting++;
          } else {
            rear++;
          }
        }
      }
    }
    // The whole exercise is pointless if hardly any parcel actually reaches a street.
    expect(fronting).toBeGreaterThan(rear * 0.4);
  });

  it('still produces disjoint parcels with the asymmetric setbacks', () => {
    for (const layout of layouts) {
      for (let a = 0; a < layout.parcels.length; a++) {
        for (let b = a + 1; b < layout.parcels.length; b++) {
          const p = layout.parcels[a];
          const q = layout.parcels[b];
          const disjoint =
            p.x + p.width <= q.x + 1e-9 ||
            q.x + q.width <= p.x + 1e-9 ||
            p.z + p.depth <= q.z + 1e-9 ||
            q.z + q.depth <= p.z + 1e-9;
          expect(disjoint).toBe(true);
        }
      }
    }
  });

  it('never lets a building sit on the carriageway', () => {
    for (const layout of layouts) {
      const spec = cityBlockGroundSpec(layout);
      const roads = (spec.nodes ?? []).filter((node) => node.id === 'road') as {
        position: [number, number, number];
        size: [number, number, number];
      }[];
      for (const parcel of layout.parcels) {
        for (const road of roads) {
          const rx0 = road.position[0] - road.size[0] * 0.5;
          const rx1 = road.position[0] + road.size[0] * 0.5;
          const rz0 = road.position[2] - road.size[2] * 0.5;
          const rz1 = road.position[2] + road.size[2] * 0.5;
          const overlaps =
            parcel.x < rx1 - 1e-9 &&
            rx0 < parcel.x + parcel.width - 1e-9 &&
            parcel.z < rz1 - 1e-9 &&
            rz0 < parcel.z + parcel.depth - 1e-9;
          expect(overlaps).toBe(false);
        }
      }
    }
  });
});
