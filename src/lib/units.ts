export type Units = "metric" | "us";

export const AF_TO_HM3 = 0.001233481837548; // 1 acre-foot = 1233,48 m³
export const CFS_TO_M3S = 0.028316846592;
export const FT_TO_M = 0.3048;
export const CFS_DAY_TO_AF = 1.983471; // 1 cfs durante 1 día = 1,98 acre-feet
export const AF_PER_DAY_TO_CFS = 1 / CFS_DAY_TO_AF;

const nf = (d: number) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: d, minimumFractionDigits: d });

export function num(v: number | null | undefined, d = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return nf(d).format(v);
}

export function signed(v: number | null | undefined, d = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = nf(d).format(Math.abs(v));
  return v > 0 ? `+${s}` : v < 0 ? `−${s}` : s;
}

/** Volumen en acre-feet → texto. */
export function vol(af: number | null | undefined, u: Units, sign = false): string {
  if (af == null || !Number.isFinite(af)) return "—";
  const f = sign ? signed : num;
  if (u === "metric") {
    const h = af * AF_TO_HM3;
    return `${f(h, Math.abs(h) < 10 ? 1 : 0)} hm³`;
  }
  const a = Math.abs(af);
  if (a >= 1e6) return `${f(af / 1e6, 2)} MAF`;
  if (a >= 1e4) return `${f(af / 1e3, 0)} kaf`;
  if (a >= 1e3) return `${f(af / 1e3, 1)} kaf`;
  return `${f(af, 0)} af`;
}

export function volVal(af: number, u: Units): number {
  return u === "metric" ? af * AF_TO_HM3 : af;
}
export const volUnit = (u: Units) => (u === "metric" ? "hm³" : "acre-feet");

export function flow(cfs: number | null | undefined, u: Units, sign = false): string {
  if (cfs == null || !Number.isFinite(cfs)) return "—";
  const f = sign ? signed : num;
  if (u === "metric") {
    const m = cfs * CFS_TO_M3S;
    return `${f(m, Math.abs(m) < 10 ? 1 : 0)} m³/s`;
  }
  return `${f(cfs, 0)} cfs`;
}
export function flowVal(cfs: number, u: Units): number {
  return u === "metric" ? cfs * CFS_TO_M3S : cfs;
}
export const flowUnit = (u: Units) => (u === "metric" ? "m³/s" : "cfs");

export function elev(ft: number | null | undefined, u: Units, sign = false): string {
  if (ft == null || !Number.isFinite(ft)) return "—";
  const f = sign ? signed : num;
  if (u === "metric") return `${f(ft * FT_TO_M, 2)} m`;
  return `${f(ft, 2)} ft`;
}
export function elevVal(ft: number, u: Units): number {
  return u === "metric" ? ft * FT_TO_M : ft;
}
export const elevUnit = (u: Units) => (u === "metric" ? "m s.n.m." : "ft");

export function pct(v: number | null | undefined, d = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${num(v * 100, d)} %`;
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
export function fdate(d: string | null | undefined): string {
  if (!d) return "—";
  return `${Number(d.slice(8, 10))} ${MES[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
}
export function fdateShort(d: string): string {
  return `${Number(d.slice(8, 10))} ${MES[Number(d.slice(5, 7)) - 1]}`;
}
export function ago(ms: number): string {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return "recién";
  if (m < 60) return `hace ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}
