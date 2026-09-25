import { describe, expect, it } from "vitest";
import { compactCalc, parseDailyOgc, wyVolumes, type Pt } from "../netlify/lib/compact";

const daily = (from: string, to: string, v: number): Pt[] => {
  const o: Pt[] = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += 86400e3) o.push([new Date(t).toISOString().slice(0, 10), v]);
  return o;
};

describe("Compact / Lee Ferry", () => {
  it("parser diario OGC", () => {
    expect(parseDailyOgc({ features: [{ properties: { time: "2026-01-02", value: "10" } }, { properties: { time: "2026-01-01", value: "5" } }, { properties: { time: "2026-01-03", value: null } }] }))
      .toEqual([["2026-01-01", 5], ["2026-01-02", 10]]);
  });
  it("volumen por año hidrológico: 10.000 cfs todo el año ≈ 7,24 MAF", () => {
    const m = wyVolumes(daily("2024-10-01", "2025-09-30", 10000));
    expect(m.get(2025)!.af).toBeCloseTo(10000 * 1.983471 * 365, 0);
    expect(m.get(2025)!.complete).toBe(true);
  });
  it("suma móvil 10 años sólo con años completos; año en curso aparte", () => {
    const lees = daily("2000-10-01", "2026-09-20", 10000), paria = daily("2000-10-01", "2026-09-20", 30);
    const c = compactCalc(lees, paria, "2026-09-25");
    const last = c.rolling.at(-1)!;
    expect(last.wy).toBe(2025);
    expect(last.af / 1e6).toBeGreaterThan(72);
    expect(c.rolling[0].wy).toBe(2010);
    expect(c.current!.wy).toBe(2026);
    expect(c.years.find((y) => y.wy === 2025)!.complete).toBe(true);
    // un hueco grande invalida el año y las sumas que lo incluyen
    const holes = lees.filter(([d]) => !(d >= "2020-01-01" && d <= "2020-01-20"));
    const c2 = compactCalc(holes, paria, "2026-09-25");
    expect(c2.years.find((y) => y.wy === 2020)!.total).toBeNull();
    expect(c2.rolling.some((r) => r.wy >= 2020 && r.wy <= 2029)).toBe(false);
  });
});
