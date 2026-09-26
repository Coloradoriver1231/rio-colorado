import { afterEach, describe, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());

describe("/api/nrcsres", () => {
  it("usa mensual si no hay diario (p. ej. San Carlos) y calcula percentiles por mes", async () => {
    const monthly = [] as any[];
    for (let y = 1991; y <= 2026; y++) for (let mo = 1; mo <= 12; mo++) if (y < 2026 || mo <= 8) monthly.push({ date: `${y}-${String(mo).padStart(2, "0")}`, value: 100000 + mo * 1000 + (y % 5) * 100 });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = (b: any) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("/stations?")) return ok([{ stationTriplet: "09469000:AZ:BOR", name: "San Carlos Reservoir", stateCode: "AZ", reservoirMetadata: { capacity: 875000, usableCapacity: 875000 } }]);
      if (url.includes("duration=DAILY")) return ok([{ stationTriplet: "09469000:AZ:BOR", data: [{ values: [] }] }]);
      return ok([{ stationTriplet: "09469000:AZ:BOR", data: [{ values: monthly }] }]);
    }));
    const h = (await import("../netlify/functions/nrcsres.mts")).default;
    expect((await h(new Request("https://x/api/nrcsres/nada"))).status).toBe(400);
    const r = await h(new Request("https://x/api/nrcsres/09469000%3AAZ%3ABOR"));
    const b = await r.json();
    expect(r.status).toBe(200);
    expect(b.freq).toBe("mensual");
    expect(b.capacity_af).toBe(875000);
    expect(b.summary.last[0]).toBe("2026-08-31");
    expect(b.monthlyStats.years).toBeGreaterThanOrEqual(30);
  });
});
