import { afterEach, describe, expect, it, vi } from "vitest";
import { addDays, doyIndex, parseHydrodata, parseUsgsIv, summarize, type Pt } from "../src/shared/process";
import { derive, estimateInflow, meanLast, systemTotals, valueAt, volumeLast, type ReservoirCat } from "../src/lib/calc";
import { flow, vol } from "../src/lib/units";

function daily(start: string, n: number, f: (i: number, d: string) => number): Pt[] {
  return Array.from({ length: n }, (_, i) => { const d = addDays(start, i); return [d, f(i, d)] as Pt; });
}

describe("parseHydrodata", () => {
  it("lee el formato verificado de USBR y descarta basura", () => {
    const pts = parseHydrodata({ columns: ["datetime", "storage"], data: [["1963-06-29", 5400.0], ["1963-06-28", 0.0], ["bad", 1], ["1963-06-30", null], ["1963-07-01", "7400"], ["1963-07-01", 7500]] });
    expect(pts).toEqual([["1963-06-28", 0], ["1963-06-29", 5400], ["1963-07-01", 7500]]);
  });
  it("falla si no hay data", () => {
    expect(() => parseHydrodata({})).toThrow();
  });
});

describe("summarize / doy", () => {
  const pts = daily("2010-01-01", 365 * 16 + 4, (i, d) => 1000 + (Number(d.slice(0, 4)) - 2010) * 10 + doyIndex(d));
  const s = summarize(pts, true)!;
  it("últimos 730 días, máximo, mensual", () => {
    expect(s.recent.length).toBe(731);
    expect(s.max[1]).toBe(Math.max(...pts.map((p) => p[1])));
    expect(s.monthly!.length).toBeGreaterThan(180);
  });
  it("percentiles excluyen el último año y exigen 5 años", () => {
    expect(s.doy).not.toBeNull();
    expect(s.doy!.years).toBeGreaterThanOrEqual(14);
    const i = doyIndex(s.last[0]);
    expect(s.doy!.p50[i]!).toBeLessThan(s.last[1]);
  });
  it("con pocos años no hay percentiles", () => {
    expect(summarize(daily("2023-01-01", 800, () => 5), false)!.doy).toBeNull();
  });
  it("29-feb cuenta como 28-feb", () => {
    expect(doyIndex("2024-02-29")).toBe(doyIndex("2023-02-28"));
    expect(doyIndex("2024-12-31")).toBe(364);
  });
});

describe("calc", () => {
  it("valueAt respeta la tolerancia", () => {
    const p: Pt[] = [["2026-01-01", 1], ["2026-01-05", 5]];
    expect(valueAt(p, "2026-01-03", 3)).toBe(1);
    expect(valueAt(p, "2026-01-04", 2)).toBeNull();
    expect(valueAt(p, "2025-12-31")).toBeNull();
  });
  it("promedios y volúmenes exigen datos suficientes", () => {
    const p = daily("2026-01-01", 30, () => 100);
    expect(meanLast(p, "2026-01-30", 7)).toBe(100);
    expect(volumeLast(p, "2026-01-30", 30)).toBeCloseTo(100 * 1.983471 * 30, 3);
    expect(volumeLast(p.slice(0, 10), "2026-01-30", 30)).toBeNull();
  });
  it("entrada estimada = salida + ΔS", () => {
    const st = daily("2026-01-01", 20, (i) => 1000000 + i * 1983.471); // +1000 cfs equivalentes por día
    const rel = daily("2026-01-01", 20, () => 5000);
    const est = estimateInflow(st, rel);
    expect(est.length).toBeGreaterThan(10);
    expect(est[est.length - 1][1]).toBeCloseTo(6000, 0);
  });

  const cat: ReservoirCat = { site: 921, name: "Lake Mead", river: "Colorado", state: "NV", sub: "baja", capacity_af: 26120000, estimate_inflow: true, major: true };
  const mk = (last: string) => {
    const st = daily(addDays(last, -729), 730, (i) => 7000000 + i * 100);
    const rel = daily(addDays(last, -729), 730, () => 10000);
    return { site: 921, fetchedAt: "", errors: {}, series: {
      storage: { first: st[0][0], last: st[st.length - 1], recent: st, max: st[st.length - 1], min: st[0], doy: null, monthly: null },
      release: { first: rel[0][0], last: rel[rel.length - 1], recent: rel, max: rel[0], min: rel[0], doy: null, monthly: null },
    } } as any;
  };
  it("derive: %, año anterior, estimada, vigencia", () => {
    const v = derive(cat, mk("2026-09-20"), "ok", undefined, "2026-09-22");
    expect(v.pct).toBeCloseTo((7000000 + 729 * 100) / 26120000, 6);
    expect(v.storageLastYear).toBe(7000000 + 364 * 100);
    expect(v.inflowEstimated).toBe(true);
    expect(v.inflow7).toBeCloseTo(10000 + 100 / 1.983471, 0);
    expect(v.stale).toBe(false);
    expect(derive(cat, mk("2026-09-10"), "ok", undefined, "2026-09-22").stale).toBe(true);
  });
  it("systemTotals ignora embalses con dato viejo", () => {
    const a = derive(cat, mk("2026-09-20"), "ok", undefined, "2026-09-22");
    const b = derive({ ...cat, site: 919, name: "Lake Powell", capacity_af: 23314000 }, mk("2026-09-01"), "ok", undefined, "2026-09-22");
    const t = systemTotals([a, b]);
    expect(t.included).toEqual(["Lake Mead"]);
    expect(t.missing).toEqual(["Lake Powell"]);
    expect(t.capacity).toBe(26120000);
  });
});

describe("unidades", () => {
  it("convierte y nunca muestra 0 si falta dato", () => {
    expect(vol(1_000_000, "metric")).toBe("1.233 hm³");
    expect(vol(5_107_000, "us")).toBe("5,11 MAF");
    expect(flow(1000, "metric")).toBe("28 m³/s");
    expect(flow(null, "metric")).toBe("—");
    expect(vol(-500, "us", true)).toBe("−500 af");
  });
});

describe("USGS", () => {
  it("parsea IV, filtra sin-dato y agrupa por hora", () => {
    const j = { value: { timeSeries: [{
      sourceInfo: { siteName: "COLORADO RIVER AT LEES FERRY, AZ", siteCode: [{ value: "09380000" }], geoLocation: { geogLocation: { latitude: 36.86, longitude: -111.58 } } },
      variable: { noDataValue: -999999 },
      values: [{ value: [
        { value: "6300", dateTime: "2026-09-25T05:00:00.000-07:00" },
        { value: "6350", dateTime: "2026-09-25T05:45:00.000-07:00" },
        { value: "-999999", dateTime: "2026-09-25T06:00:00.000-07:00" },
        { value: "6400", dateTime: "2026-09-25T06:15:00.000-07:00" },
      ] }],
    }] } };
    const g = parseUsgsIv(j)["09380000"];
    expect(g.series.map((p) => p[1])).toEqual([6350, 6400]);
    expect(g.lat).toBe(36.86);
  });
});

describe("funciones Netlify", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("usbr: rechaza embalses fuera del catálogo", async () => {
    const f = (await import("../netlify/functions/usbr.mts")).default;
    const r = await f(new Request("https://x/api/usbr/12345"));
    expect(r.status).toBe(404);
  });
  it("usbr: arma el resumen y tolera series no publicadas", async () => {
    const pts = daily("2020-01-01", 2000, (i) => i);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.endsWith("/29.json")) return new Response("nf", { status: 404 });
      return new Response(JSON.stringify({ columns: ["datetime", "x"], data: pts }), { status: 200 });
    }));
    const f = (await import("../netlify/functions/usbr.mts")).default;
    const r = await f(new Request("https://x/api/usbr/919"));
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.series.storage.last).toEqual(pts[pts.length - 1]);
    expect(b.series.inflow).toBeNull();
    expect(b.errors.inflow).toBe("no publicada");
    expect(b.series.storage.monthly.length).toBeGreaterThan(60);
    expect(b.series.release.monthly).toBeNull();
    expect(r.headers.get("netlify-cdn-cache-control")).toContain("s-maxage=3600");
  });
  it("usbr: error de red → 502 sin cache largo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const f = (await import("../netlify/functions/usbr.mts")).default;
    const r = await f(new Request("https://x/api/usbr/919"));
    expect(r.status).toBe(502);
    expect(r.headers.get("netlify-cdn-cache-control")).toBe("public, s-maxage=120");
  });
  it("usgs: pide todas las estaciones del catálogo", async () => {
    const spy = vi.fn(async () => new Response(JSON.stringify({ value: { timeSeries: [] } }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    const f = (await import("../netlify/functions/usgs.mts")).default;
    const r = await f();
    expect(r.status).toBe(200);
    const url = (spy.mock.calls[0] as any)[0] as string;
    expect(url).toContain("waterservices.usgs.gov/nwis/iv/");
    expect(url).toContain("09380000");
    expect(url).toContain("09522000");
  });
});
