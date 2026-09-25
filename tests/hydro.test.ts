import { afterEach, describe, expect, it, vi } from "vitest";
import { km, matchHdb, parseAwdbValues, parseHdbMeta, valueAt } from "../netlify/lib/hydro";

const META =
  "site_datatype_id,site_id,datatype_id,site_metadata.site_id,site_metadata.site_name,site_metadata.site_common_name,site_metadata.lat,site_metadata.longi\n" +
  '1,921,17,921,"Lake Mead, Hoover Dam",HDMLC,36.0163,-114.7374\n' +
  '2,921,42,921,"Lake Mead, Hoover Dam",HDMLC,36.0163,-114.7374\n' +
  "3,919,17,919,Lake Powell,LAKE POWELL,36.93649,-111.48396\n";

describe("HDB meta.csv", () => {
  it("agrupa datatypes por sitio y respeta comillas", () => {
    expect(parseHdbMeta(META).find((x) => x.site_id === 921)!.datatypes).toEqual([17, 42]);
  });
  it("vincula NRCS ↔ USBR por distancia", () => {
    const s = parseHdbMeta(META);
    expect(matchHdb(36.01667, -114.73333, s)!.site_id).toBe(921); // Lake Mead según NRCS
    expect(matchHdb(36.93816, -111.4845, s)!.site_id).toBe(919); // Lake Powell según NRCS
    expect(matchHdb(40, -106, s)).toBeNull();
    expect(km(0, 0, 0, 1)).toBeGreaterThan(111);
  });
});

describe("NRCS AWDB", () => {
  it("diario (formato verificado) y mensual", () => {
    expect(parseAwdbValues([{ date: "2026-09-24", value: 5137945 }, { date: "2026-09-23", value: 5133544 }]))
      .toEqual([["2026-09-23", 5133544], ["2026-09-24", 5137945]]);
    expect(parseAwdbValues([{ year: 2026, month: 2, value: 10 }])).toEqual([["2026-02-28", 10]]);
    expect(parseAwdbValues([{ date: "2026-08", value: 3 }, { date: "2026-07-01" }])).toEqual([["2026-08-31", 3]]);
    expect(valueAt([["2026-09-20", 7]], "2026-09-22")).toBe(7);
    expect(valueAt([["2026-09-10", 7]], "2026-09-22")).toBeNull();
  });
});

describe("función basin", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("arma embalses con capacidad, vínculo USBR, cambios y mensual de respaldo", async () => {
    const d = (n: number) => new Date(Date.now() - n * 86400e3).toISOString().slice(0, 10);
    const stations = [
      { stationTriplet: "09421000:AZ:BOR", name: "Lake Mead", stateCode: "AZ", huc: "150100051310", latitude: 36.01667, longitude: -114.73333, reservoirMetadata: { capacity: 26159000, usableCapacity: 26159000 } },
      { stationTriplet: "09009060:CO:BOR", name: "Lake Granby", stateCode: "CO", huc: "140100010308", latitude: 40.18333, longitude: -105.86667, reservoirMetadata: { capacity: 465600, usableCapacity: 465600 } },
      { stationTriplet: "X:UT:BOR", name: "Fuera de cuenca", stateCode: "UT", huc: "160202040101", latitude: 41, longitude: -112, reservoirMetadata: { capacity: 1 } },
    ];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = (b: any) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: 200 });
      if (url.includes("/stations?")) return ok(stations);
      if (url.endsWith("meta.csv")) return ok(META);
      if (url.includes("duration=DAILY"))
        return ok([{ stationTriplet: "09009060:CO:BOR", data: [{ values: [{ date: d(366), value: 300000 }, { date: d(31), value: 210000 }, { date: d(8), value: 205000 }, { date: d(1), value: 200000 }] }] }]);
      if (url.includes("duration=MONTHLY"))
        return ok([{ stationTriplet: "09421000:AZ:BOR", data: [{ values: [{ date: d(25).slice(0, 7), value: 6800000 }] }] }]);
      return new Response("", { status: 404 });
    }));
    const f = (await import("../netlify/functions/basin.mts")).default;
    const r = await f();
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.reservoirs.length).toBe(2);
    const granby = b.reservoirs.find((x: any) => x.name === "Lake Granby");
    expect(granby).toMatchObject({ basin: "alta", subbasin: "Colorado Headwaters", capacity_af: 465600, freq: "diario", af: 200000, ch7: -5000, ch30: -10000, last_year_af: 300000, hdb_site: null });
    const mead = b.reservoirs.find((x: any) => x.name === "Lake Mead");
    expect(mead).toMatchObject({ basin: "baja", hdb_site: 921, freq: "mensual", af: 6800000 });
  });
  it("NRCS caído → 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const f = (await import("../netlify/functions/basin.mts")).default;
    expect((await f()).status).toBe(502);
  });
});
