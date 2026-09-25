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

  it("todo bien: una consulta por tanda, guarda en Blobs", async () => {
    const f = vi.fn(async (url: string) => ok(iv(sitesOf(url))));
    vi.stubGlobal("fetch", f);
    const h = (await import("../netlify/functions/usgs.mts")).default;
    const r = await h();
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(Object.keys(b.gauges).length).toBe(IDS.length);
    expect(f.mock.calls.every((c: any) => String(c[0]).includes("waterservices.usgs.gov/nwis/iv/"))).toBe(true);
    expect(mem.get("usgs")).toBeTruthy();
  });

  it("waterservices con 503 → reintenta y usa la API nueva para lo que falta", async () => {
    const f = vi.fn(async (url: string) => {
      if (url.includes("waterservices")) return new Response("down", { status: 503 });
      const id = /USGS-(\d+)/.exec(url)![1];
      return ok({ features: [{ properties: { time: new Date(Date.now() - 3600e3).toISOString(), value: id === "09380000" ? "6260" : "10" } }] });
    });
    vi.stubGlobal("fetch", f);
    const h = (await import("../netlify/functions/usgs.mts")).default;
    const b = await (await h()).json();
    expect(b.gauges["09380000"].series.at(-1)[1]).toBe(6260);
    expect(Object.keys(b.gauges).length).toBe(IDS.length);
  }, 20000);

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
