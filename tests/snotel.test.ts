import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@netlify/blobs", () => ({ getStore: () => ({ get: async () => null, setJSON: async () => {} }) }));
afterEach(() => vi.unstubAllGlobals());

describe("AWDB con reintentos", () => {
  it("si una tanda falla, la parte y reintenta; sólo la estación que sigue fallando queda con error", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ids = decodeURIComponent(/stationTriplets=([^&]+)/.exec(url)![1]).split(",");
      if (ids.includes("3:CO:SNTL")) return new Response("x", { status: 503 });
      return new Response(JSON.stringify(ids.map((id) => ({ stationTriplet: id, data: [{ stationElement: { elementCode: "WTEQ" }, values: [{ date: "2026-01-01", value: 1 }] }] }))), { status: 200 });
    }));
    const { awdbDaily } = await import("../netlify/lib/snow");
    const r = await awdbDaily(["1:CO:SNTL", "2:CO:SNTL", "3:CO:SNTL", "4:CO:SNTL"], "WTEQ", "2026-01-01", "2026-01-01", false, 4, 2, 2000, 8000);
    expect([...r.data.keys()].sort()).toEqual(["1:CO:SNTL", "2:CO:SNTL", "4:CO:SNTL"]);
    expect(r.failedIds).toEqual(["3:CO:SNTL"]);
  }, 20000);
});

describe("/api/snotel", () => {
  it("valida el id y devuelve la serie de la estación", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify([{ stationTriplet: "335:CO:SNTL", data: [
      { stationElement: { elementCode: "WTEQ" }, values: [{ date: "2026-04-01", value: 7.6, median: 18.2 }] },
      { stationElement: { elementCode: "SNWD" }, values: [{ date: "2026-04-01", value: 21 }] },
    ] }]), { status: 200 })));
    const h = (await import("../netlify/functions/snotel.mts")).default;
    expect((await h(new Request("https://x/api/snotel/hola"))).status).toBe(400);
    const r = await h(new Request("https://x/api/snotel/335%3ACO%3ASNTL?wy=2026"));
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.swe[0]).toEqual({ date: "2026-04-01", value: 7.6, median: 18.2 });
    expect(b.links.nrcs).toContain("sitenum=335");
  });
});
