import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregate, aprJul, parseAwdbData, waterYear, windowPrecip, type StationNow, type Val } from "../netlify/lib/snow";
import { fit, pearson, quantile } from "../netlify/lib/stats";

describe("año hidrológico", () => {
  it("1-oct empieza el WY siguiente; 30-sep cierra", () => {
    expect(waterYear("2025-10-01")).toBe(2026);
    expect(waterYear("2026-09-30")).toBe(2026);
    expect(waterYear("2026-01-15")).toBe(2026);
  });
});

describe("AWDB (formato verificado)", () => {
  it("lee valor, mediana y promedio", () => {
    const j = [{ stationTriplet: "335:CO:SNTL", data: [{ stationElement: { elementCode: "WTEQ" }, values: [{ date: "2026-04-01", value: 7.6, qcFlag: "V", average: 18.3, median: 18.2 }] }] }];
    expect(parseAwdbData(j).get("335:CO:SNTL")!.WTEQ[0]).toEqual({ date: "2026-04-01", value: 7.6, median: 18.2, average: 18.3 });
  });
});

describe("precipitación de ventanas", () => {
  const s: Val[] = [
    { date: "2026-09-20", value: 20, average: 19 }, { date: "2026-09-30", value: 21, average: 19.5 },
    { date: "2026-10-01", value: 0.1, average: 0.05 }, { date: "2026-10-05", value: 0.6, average: 0.4 },
  ];
  it("misma temporada: diferencia", () => {
    expect(windowPrecip(s, "2026-09-20", "2026-09-30", (v) => v.value)).toBeCloseTo(1);
  });
  it("cruza el 1-oct: resto del año anterior + acumulado nuevo", () => {
    expect(windowPrecip(s, "2026-09-20", "2026-10-05", (v) => v.value)).toBeCloseTo(1 + 0.6);
    expect(windowPrecip(s, "2026-09-20", "2026-10-05", (v) => v.average)).toBeCloseTo(0.5 + 0.4);
  });
  it("falta un extremo → null (no se inventa)", () => {
    expect(windowPrecip(s, "2026-09-21", "2026-09-30", (v) => v.value)).toBeNull();
  });
});

describe("agregado de cuenca", () => {
  const st = (swe: number | null, med: number | null): StationNow => ({ id: "x", name: "x", elev: 1, lat: 0, lon: 0, subbasin: "", basin: "alta", date: "2026-02-01",
    swe, sweMed: med, snwd: null, prec: 10, precMed: 12, p7: 1, p7avg: 0.5, p30: 2, p30avg: 4 });
  it("% = suma valores / suma medianas", () => {
    const a = aggregate([st(10, 20), st(5, 10), st(null, 30)], 5);
    expect(a.swePct).toBeCloseTo(15 / 30);
    expect(a.n).toBe(2);
    expect(a.p7Pct).toBeCloseTo(2);
    expect(a.p30Pct).toBeCloseTo(0.5);
  });
  it("sin nieve estacional (mediana < 1\") → % no aplica", () => {
    expect(aggregate([st(0, 0.2)], 1).swePct).toBeNull();
  });
});

describe("aporte abril–julio", () => {
  it("suma sólo abril–julio y exige 118 de 122 días", () => {
    let csv = "datetime,unregulated inflow volume\n";
    for (let t = Date.parse("2020-03-01"); t <= Date.parse("2020-08-31"); t += 86400e3) csv += `${new Date(t).toISOString().slice(0, 10)},10\n`;
    for (let t = Date.parse("2021-04-01"); t <= Date.parse("2021-05-31"); t += 86400e3) csv += `${new Date(t).toISOString().slice(0, 10)},10\n`;
    const r = aprJul(csv);
    expect(r.get(2020)).toBe(1220);
    expect(r.has(2021)).toBe(false);
  });
});

describe("estadística", () => {
  it("regresión recupera y = 2 + 3x y valida fuera de muestra", () => {
    const X = Array.from({ length: 20 }, (_, i) => [i / 2]);
    const y = X.map(([x], i) => 2 + 3 * x + (i % 2 ? 0.1 : -0.1));
    const f = fit(X, y, ["x"])!;
    expect(f.coef[0]).toBeCloseTo(2, 1);
    expect(f.coef[1]).toBeCloseTo(3, 1);
    expect(f.looR2).toBeGreaterThan(0.99);
    expect(f.looR2).toBeLessThanOrEqual(f.r2);
  });
  it("dos predictores", () => {
    const X = Array.from({ length: 20 }, (_, i) => [i, (i * 7) % 5]);
    const y = X.map(([a, b]) => 1 + a - 2 * b);
    const f = fit(X, y, ["a", "b"])!;
    expect(f.coef.map((c) => Math.round(c * 1000) / 1000)).toEqual([1, 1, -2]);
  });
  it("pocos datos → null", () => {
    expect(fit([[1], [2], [3]], [1, 2, 3], ["x"])).toBeNull();
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1);
  });
});

describe("modelo completo con datos simulados", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fuera de temporada: referencia al 1-abr, sin estimación, confianza insuficiente", async () => {
    const stations = Array.from({ length: 12 }, (_, i) => ({ stationTriplet: `${i}:CO:SNTL`, name: `S${i}`, huc: "140100010101", elevation: 10000, latitude: 39, longitude: -106 }));
    // SWE del año y en la estación i = (y − 1985) * (1 + i/10) ; runoff = 200000 * (y − 1985)
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = (b: any) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: 200 });
      if (url.includes("/stations?")) return ok(stations);
      if (url.includes("/csv/34.csv")) {
        let c = "datetime,unregulated inflow volume\n";
        for (let y = 1990; y <= 2026; y++) for (let t = Date.parse(`${y}-04-01`); t <= Date.parse(`${y}-07-31`); t += 86400e3) c += `${new Date(t).toISOString().slice(0, 10)},${(200000 * (y - 1985)) / 122}\n`;
        return ok(c);
      }
      if (url.includes("/data?")) {
        const d = /beginDate=(\d{4}-\d{2}-\d{2})/.exec(url)![1];
        const y = Number(d.slice(0, 4));
        return ok(stations.map((s, i) => ({ stationTriplet: s.stationTriplet, data: [
          { stationElement: { elementCode: "WTEQ" }, values: [{ date: d, value: (y - 1985) * (1 + i / 10) }] },
          { stationElement: { elementCode: "PREC" }, values: [{ date: d, value: 10 + ((y * 7) % 11) }] },
        ] })));
      }
      return new Response("", { status: 404 });
    }));
    const { buildModel } = await import("../netlify/lib/snow");
    const m = (await buildModel(Date.parse("2026-09-25T15:00:00Z")))!;
    expect(m.md).toBe("04-01");
    expect(m.inSeason).toBe(false);
    expect(m.estimate).toBeNull();
    expect(m.confidence.level).toBe("insuficiente");
    expect(m.years.at(-1)!.wy).toBe(2026); // abril–julio 2026 ya completo en septiembre
    expect(m.chosen).not.toBeNull();
    expect(m.models.find((x) => x.name === "SWE")!.looR2!).toBeGreaterThan(0.99);
    expect(m.models.some((x) => x.kind === "años análogos")).toBe(true);
    expect(m.retro.length).toBeGreaterThan(30);
    expect(m.climatology.n).toBe(30);
  });
  it("en temporada: estimación con rango y confianza", async () => {
    const kOf = (y: number) => 5 + ((y * 37) % 29); // SWE "aleatorio" por año, sin tendencia
    const stations = Array.from({ length: 12 }, (_, i) => ({ stationTriplet: `${i}:CO:SNTL`, name: `S${i}`, huc: "140100010101", elevation: 10000, latitude: 39, longitude: -106 }));
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = (b: any) => new Response(typeof b === "string" ? b : JSON.stringify(b), { status: 200 });
      if (url.includes("/stations?")) return ok(stations);
      if (url.includes("/csv/34.csv")) {
        let c = "datetime,x\n";
        for (let y = 1990; y <= 2025; y++) for (let t = Date.parse(`${y}-04-01`); t <= Date.parse(`${y}-07-31`); t += 86400e3) c += `${new Date(t).toISOString().slice(0, 10)},${(200000 * kOf(y) + (y % 3) * 50000) / 122}\n`;
        return ok(c);
      }
      if (url.includes("/data?")) {
        const d = /endDate=(\d{4}-\d{2}-\d{2})/.exec(url)![1];
        const wy = Number(d.slice(0, 4)) + (Number(d.slice(5, 7)) >= 10 ? 1 : 0);
        const k = wy >= 2026 ? 20 : kOf(wy);
        return ok(stations.map((s, i) => ({ stationTriplet: s.stationTriplet, data: [
          { stationElement: { elementCode: "WTEQ" }, values: [{ date: d, value: k * (1 + i / 10) }] },
          { stationElement: { elementCode: "PREC" }, values: [{ date: d, value: 10 + ((wy * 7) % 11) }] },
        ] })));
      }
      return new Response("", { status: 404 });
    }));
    const { buildModel } = await import("../netlify/lib/snow");
    const m = (await buildModel(Date.parse("2026-03-10T15:00:00Z")))!;
    expect(m.inSeason).toBe(true);
    expect(m.md).toBe("03-10");
    expect(m.estimate!.low).toBeLessThan(m.estimate!.central);
    expect(m.estimate!.high).toBeGreaterThan(m.estimate!.central);
    expect(m.estimate!.central).toBeGreaterThan(3.5e6);
    expect(m.estimate!.central).toBeLessThan(4.5e6);
    expect(["alta", "media"]).toContain(m.confidence.level);
    const ch = m.models.find((x) => x.name === m.chosen)!;
    expect(ch.skill!.coverage80).not.toBeNull();
    expect(ch.skill!.n).toBeGreaterThanOrEqual(30);
  });
});

describe("estado de nieve (buildStatus) con datos simulados", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("agrega estaciones, ventanas de lluvia y pronóstico oficial (formato verificado)", async () => {
    const stations = [
      { stationTriplet: "1:CO:SNTL", name: "A", huc: "140100010101", elevation: 10000, latitude: 39, longitude: -106 },
      { stationTriplet: "2:AZ:SNTL", name: "B", huc: "150601010101", elevation: 8000, latitude: 34, longitude: -111 },
    ];
    const series = (start: string, end: string, f: (d: string, i: number) => any) => {
      const out = []; let i = 0;
      for (let t = Date.parse(start); t <= Date.parse(end); t += 86400e3, i++) { const d = new Date(t).toISOString().slice(0, 10); out.push({ date: d, ...f(d, i) }); }
      return out;
    };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const ok = (b: any) => new Response(JSON.stringify(b), { status: 200 });
      if (url.includes("/stations?")) return ok(stations);
      if (url.includes("/forecasts?"))
        return ok([{ stationTriplet: "09379900:AZ:USGS", data: [{ elementCode: "SRVO", forecastPeriod: ["04-01", "07-31"], publicationDate: "2026-02-01 00:00", issueDate: "2026-02-05 10:00", periodNormal: 6130, unitCode: "kac_ft", forecastValues: { "90": 1680, "50": 3210, "10": 5370 } }] }]);
      if (url.includes("elements=SNWD")) return ok([]);
      const b = /beginDate=([\d-]+)/.exec(url)![1], e = /endDate=([\d-]+)/.exec(url)![1];
      return ok(stations.map((s) => ({ stationTriplet: s.stationTriplet, data: [
        { stationElement: { elementCode: "WTEQ" }, values: series(b, e, () => ({ value: 5, median: 10, average: 11 })) },
        { stationElement: { elementCode: "PREC" }, values: series(b, e, (d, i) => ({ value: 0.1 * i, median: 0.05 * i, average: 0.05 * i })) },
      ] })));
    }));
    const { buildStatus } = await import("../netlify/lib/snow");
    const st = (await buildStatus(Date.parse("2026-02-10T15:00:00Z")))!;
    expect(st.wy).toBe(2026);
    expect(st.stations.length).toBe(2);
    expect(st.basins.alta.swePct).toBeCloseTo(0.5);
    expect(st.basins.alta.p7).toBeCloseTo(0.7);
    expect(st.basins.alta.p7Pct).toBeCloseTo(2);
    expect(st.forecasts[0]).toMatchObject({ publicationDate: "2026-02-01", unit: "kac_ft", normal: 6130 });
    expect(st.forecasts[0].values["50"]).toBe(3210);
    expect(st.season.alta.dates[0]).toBe("2025-10-01");
    expect(st.season.alta.dates.at(-1)).toBe("2026-02-10");
  });
});
