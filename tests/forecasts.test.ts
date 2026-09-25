import { describe, expect, it } from "vitest";
import { parseForecastGroups } from "../netlify/functions/forecasts.mts";

describe("pronósticos NRCS (formato verificado, agrupado por estación)", () => {
  it("agrupa por punto con su nombre", () => {
    const j = [{ stationTriplet: "09124800:CO:USGS", forecastPointName: "Blue Mesa Reservoir Inflow ", data: [{ elementCode: "SRVO", forecastPeriod: ["04-01", "07-31"], publicationDate: "2026-04-01 00:00", unitCode: "kac_ft", periodNormal: 575, forecastValues: { "90": 139, "50": 205, "10": 340 } }] }];
    const g = parseForecastGroups(j);
    expect(g.get("09124800:CO:USGS")!.name).toBe("Blue Mesa Reservoir Inflow");
    expect(g.get("09124800:CO:USGS")!.recs[0].forecastValues["50"]).toBe(205);
    expect(parseForecastGroups(null).size).toBe(0);
  });
});
