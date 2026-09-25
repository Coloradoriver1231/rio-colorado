import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, any>();
vi.mock("@netlify/blobs", () => ({
  getStore: () => ({
    get: async (k: string) => mem.get(k) ?? null,
    setJSON: async (k: string, v: any) => { mem.set(k, JSON.parse(JSON.stringify(v))); },
  }),
}));

import { parseUsgsOgcContinuous } from "../src/shared/process";
import { IDS, merge } from "../netlify/lib/usgs";

const iv = (ids: string[], v = 6000) => ({ value: { timeSeries: ids.map((id) => ({
  sourceInfo: { siteName: id, siteCode: [{ value: id }], geoLocation: { geogLocation: { latitude: 36, longitude: -111 } } },
  variable: { noDataValue: -999999 },
  values: [{ value: [{ value: String(v), dateTime: new Date(Date.now() - 3600e3).toISOString() }] }],
})) } });
const ok = (j: any) => new Response(JSON.stringify(j), { status: 200 });
const sitesOf = (url: string) => (/sites=([^&]+)/.exec(url)?.[1] || "").split(",");

beforeEach(() => mem.clear());
afterEach(() => vi.unstubAllGlobals());

describe("USGS", () => {
  it("parser API nueva: último valor de cada hora, descarta nulos", () => {
    const t = Date.parse("2026-09-25T10:00:00Z");
    const s = parseUsgsOgcContinuous({ features: [
      { properties: { time: new Date(t + 5 * 60e3).toISOString(), value: "100" } },
      { properties: { time: new Date(t + 50 * 60e3).toISOString(), value: "120" } },
      { properties: { time: new Date(t + 65 * 60e3).toISOString(), value: null } },
    ] });
    expect(s).toEqual([[t, 120]]);
  });

  const ogc = (v: number, unit = "ft^3/s") => ({ type: "FeatureCollection", features: [{ properties: { time: new Date(Date.now() - 3600e3).toISOString(), value: String(v), unit_of_measure: unit } }] });

  it("API nueva v1 es la fuente principal; waterservices no se consulta si v1 anda", async () => {
    const f = vi.fn(async (url: string) => ok(ogc(/USGS-09380000/.test(url) ? 6260 : 10)));
    vi.stubGlobal("fetch", f);
    const h = (await import("../netlify/functions/usgs.mts")).default;
    const b = await (await h()).json();
    expect(Object.keys(b.gauges).length).toBe(IDS.length);
    expect(b.gauges["09380000"].series.at(-1)[1]).toBe(6260);
    const urls = f.mock.calls.map((c: any) => String(c[0]));
    expect(urls.every((u) => u.includes("api.waterdata.usgs.gov/ogcapi/v1/collections/continuous/items"))).toBe(true);
    expect(urls.some((u) => u.includes("waterservices"))).toBe(false);
    expect(mem.get("usgs")).toBeTruthy();
  });

  it("v1 falla → v0; ambas fallan → waterservices (sólo antes del 22-feb-2027)", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("/v1/")) return new Response("x", { status: 404 });
      if (url.includes("/v0/")) return /USGS-09380000/.test(url) ? ok(ogc(5000)) : new Response("x", { status: 500 });
      return ok(iv(sitesOf(url)));
    });
    vi.stubGlobal("fetch", f);
    const { fetchUsgs, LEGACY_SUNSET } = await import("../netlify/lib/usgs");
    const r = await fetchUsgs(20000, Date.parse("2026-09-25T00:00:00Z"));
    expect(r.gauges["09380000"].series[0][1]).toBe(5000);
    expect(Object.keys(r.gauges).length).toBe(IDS.length);
    f.mockClear();
    const r2 = await fetchUsgs(20000, LEGACY_SUNSET + 1);
    expect(r2.gauges["09380000"].series[0][1]).toBe(5000);
    expect(Object.keys(r2.gauges).length).toBe(1);
    expect(f.mock.calls.some((c: any) => String(c[0]).includes("waterservices"))).toBe(false);
  }, 30000);

  it("unidades métricas se descartan; 429 corta la ronda", async () => {
    let n = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (url.includes("waterservices")) return new Response("x", { status: 503 });
      n++;
      if (n === 1) return ok(ogc(10, "m^3/s"));
      return new Response("slow down", { status: 429 });
    }));
    const { fetchUsgs } = await import("../netlify/lib/usgs");
    const r = await fetchUsgs(8000, Date.parse("2026-09-25T00:00:00Z"));
    expect(r.errors.some((e) => e.includes("unidad inesperada"))).toBe(true);
    expect(r.errors.some((e) => e.includes("429"))).toBe(true);
    expect(n).toBeLessThan(IDS.length);
  }, 30000);

  it("USGS caído del todo → devuelve lo guardado marcado como viejo", async () => {
    mem.set("usgs", merge(null, { "09380000": { id: "09380000", name: "x", lat: null, lon: null, series: [[Date.now() - 7200e3, 5000]] } }, new Date(Date.now() - 3600e3)));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const h = (await import("../netlify/functions/usgs.mts")).default;
    const r = await h();
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.stale).toBe(true);
    expect(b.gauges["09380000"].series[0][1]).toBe(5000);
  }, 20000);

  it("sin nada guardado y USGS caído → 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    const h = (await import("../netlify/functions/usgs.mts")).default;
    expect((await h()).status).toBe(502);
  }, 20000);

  it("merge conserva la estación que no vino ahora", () => {
    const prev = merge(null, { a: { id: "a", name: "a", lat: null, lon: null, series: [[Date.now(), 1]] } } as any);
    const m = merge(prev, {});
    expect(Object.keys(m.gauges)).toEqual([]); // "a" no está en el catálogo
    const id = IDS[0];
    const p2 = merge(null, { [id]: { id, name: id, lat: null, lon: null, series: [[Date.now(), 1]] } });
    expect(merge(p2, {}).gauges[id].series.length).toBe(1);
  });
});
