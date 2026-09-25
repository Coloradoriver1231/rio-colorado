import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateWeather, cellFor, inPolygon, pickPoints, probRange } from "../netlify/lib/outlook";

describe("CPC", () => {
  const sq: [number, number][] = [[-108, 38], [-104, 38], [-104, 41], [-108, 41], [-108, 38]];
  const hole: [number, number][] = [[-107, 39], [-105, 39], [-105, 40], [-107, 40], [-107, 39]];
  it("punto en polígono con hueco", () => {
    expect(inPolygon(-106.5, 38.5, [sq])).toBe(true);
    expect(inPolygon(-106, 39.5, [sq, hole])).toBe(false);
    expect(inPolygon(-110, 39.5, [sq])).toBe(false);
  });
  it("rango de probabilidad (límite inferior del contorno)", () => {
    expect(probRange(33)).toBe("33–40 %");
    expect(probRange(50)).toBe("50–60 %");
  });
  it("elige el contorno de mayor probabilidad; fuera de todo = igual probabilidad", () => {
    const f = [
      { attributes: { prob: 33, cat: "Above" }, geometry: { rings: [sq] } },
      { attributes: { prob: 40, cat: "Above" }, geometry: { rings: [hole] } },
    ];
    expect(cellFor(f, -106, 39.5)).toEqual({ cat: "Above", prob: 40, range: "40–50 %" });
    expect(cellFor(f, -107.5, 38.5)).toEqual({ cat: "Above", prob: 33, range: "33–40 %" });
    expect(cellFor(f, -120, 30)).toEqual({ cat: "EC", prob: null, range: null });
  });
});

describe("pronóstico 10 días", () => {
  it("3 estaciones más altas por subcuenca, con altura en metros", () => {
    const st = [1, 2, 3, 4].map((i) => ({ id: `${i}`, name: `S${i}`, elev: 9000 + i * 100, lat: 39, lon: -106, huc4: "1401", subbasin: "Colorado Headwaters", basin: "alta" as const }));
    const p = pickPoints(st);
    expect(p.map((x) => x.name)).toEqual(["S4", "S3", "S2"]);
    expect(p[0].elevM).toBe(Math.round(9400 * 0.3048));
    expect(pickPoints(null).length).toBe(4);
  });
  it("promedia por región y suma el total del período", () => {
    const pts = [{ name: "a", region: "R", lat: 0, lon: 0, elevM: 3000 }, { name: "b", region: "R", lat: 0, lon: 0, elevM: 3000 }];
    const raw = [
      { daily: { time: ["2026-10-01", "2026-10-02"], snowfall_sum: [2, 4], precipitation_sum: [3, 5], temperature_2m_min: [-5, -6], temperature_2m_max: [2, 1] } },
      { daily: { time: ["2026-10-01", "2026-10-02"], snowfall_sum: [0, 8], precipitation_sum: [1, null], temperature_2m_min: [-3, -4], temperature_2m_max: [4, 3] } },
    ];
    const w = aggregateWeather(pts, raw)!;
    expect(w.regions[0].snowCm).toEqual([1, 6]);
    expect(w.regions[0].totalSnowCm).toBe(7);
    expect(w.regions[0].precMm).toEqual([2, 5]);
    expect(aggregateWeather(pts, null)).toBeNull();
  });
});

describe("/api/outlook", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("junta Open-Meteo y CPC", async () => {
    vi.mock("@netlify/blobs", () => ({ getStore: () => ({ get: async () => null, setJSON: async () => {} }) }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = (b: any) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("open-meteo")) return ok([0, 1, 2, 3].map(() => ({ daily: { time: ["2026-10-01"], snowfall_sum: [5], precipitation_sum: [4], temperature_2m_min: [-5], temperature_2m_max: [3] } })));
      return ok({ features: [{ attributes: { prob: 33, cat: "Above", valid_seas: "OND 2026", fcst_date: 1789603200000 }, geometry: { rings: [[[-125, 30], [-100, 30], [-100, 45], [-125, 45], [-125, 30]]] } }] });
    }));
    const h = (await import("../netlify/functions/outlook.mts")).default;
    const b = await (await h()).json();
    expect(b.weather.regions.length).toBe(4);
    expect(b.cpc.leads[0].season).toBe("OND 2026");
    expect(b.cpc.leads[0].prcp.headwaters).toEqual({ cat: "Above", prob: 33, range: "33–40 %" });
    expect(b.cpc.issued).toBe("2026-09-17");
  });
});
