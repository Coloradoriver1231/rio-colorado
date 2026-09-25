import { afterEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, any>();
vi.mock("@netlify/blobs", () => ({
  getStore: () => ({ get: async (k: string) => mem.get(k) ?? null, setJSON: async (k: string, v: any) => { mem.set(k, JSON.parse(JSON.stringify(v))); } }),
}));

afterEach(() => { vi.unstubAllGlobals(); mem.clear(); });

describe("/api/snow", () => {
  it("sin datos guardados: arma la versión liviana (32 días), la guarda y guarda la lista de estaciones", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      urls.push(url);
      const ok = (b: any) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("/stations?")) return ok([{ stationTriplet: "1:CO:SNTL", name: "A", huc: "140100010101", elevation: 10000, latitude: 39, longitude: -106 }]);
      if (url.includes("/forecasts?")) return ok([]);
      const e = /endDate=([\d-]+)/.exec(url)![1];
      return ok([{ stationTriplet: "1:CO:SNTL", data: [{ stationElement: { elementCode: "WTEQ" }, values: [{ date: e, value: 0, median: 0.1, average: 0.1 }] }] }]);
    }));
    const h = (await import("../netlify/functions/snow.mts")).default;
    const r = await h();
    expect(r.status).toBe(200);
    const b = await r.json();
    expect(b.status.light).toBe(true);
    expect(b.model).toBeNull();
    expect(mem.get("snow-status").light).toBe(true);
    expect(mem.get("snotel-stations").length).toBe(1);
    const data = urls.find((u) => u.includes("elements=WTEQ,PREC"))!;
    const begin = /beginDate=([\d-]+)/.exec(data)![1], end = /endDate=([\d-]+)/.exec(data)![1];
    expect((Date.parse(end) - Date.parse(begin)) / 86400e3).toBe(32);
  });
  it("NRCS caído y nada guardado → 502 con mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    const h = (await import("../netlify/functions/snow.mts")).default;
    const r = await h();
    expect(r.status).toBe(502);
  });
});
