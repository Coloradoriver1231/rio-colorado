/**
 * Estadística simple y transparente para la "Estimación del monitor".
 * Regresión lineal por mínimos cuadrados (1 o 2 predictores) + validación cruzada dejando un año afuera (LOO).
 * Sin librerías: todo se puede revisar a mano.
 */

export interface Fit {
  predictors: string[];
  coef: number[]; // [intercepto, b1, (b2)]
  n: number;
  r2: number; // en la muestra
  looR2: number; // validación cruzada (dejando un año afuera): la medida de habilidad que se usa
  looRmse: number; // error típico de predicción fuera de muestra (mismas unidades que y)
}

/** Resuelve (XᵀX)β = Xᵀy para 2 o 3 parámetros (Gauss con pivoteo). Devuelve null si es singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

export function ols(X: number[][], y: number[]): number[] | null {
  const p = X[0].length + 1;
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (let i = 0; i < y.length; i++) {
    const row = [1, ...X[i]];
    for (let a = 0; a < p; a++) {
      b[a] += row[a] * y[i];
      for (let c = 0; c < p; c++) A[a][c] += row[a] * row[c];
    }
  }
  return solve(A, b);
}

export const predict = (coef: number[], x: number[]) => coef[0] + x.reduce((s, v, i) => s + coef[i + 1] * v, 0);

export function fit(X: number[][], y: number[], predictors: string[]): Fit | null {
  const n = y.length;
  if (n < predictors.length + 4) return null;
  const coef = ols(X, y);
  if (!coef) return null;
  const mean = y.reduce((a, b) => a + b, 0) / n;
  const sst = y.reduce((a, v) => a + (v - mean) ** 2, 0);
  if (sst <= 0) return null;
  const sse = y.reduce((a, v, i) => a + (v - predict(coef, X[i])) ** 2, 0);
  let press = 0;
  for (let i = 0; i < n; i++) {
    const c = ols(X.filter((_, k) => k !== i), y.filter((_, k) => k !== i));
    if (!c) return null;
    press += (y[i] - predict(c, X[i])) ** 2;
  }
  return { predictors, coef, n, r2: 1 - sse / sst, looR2: 1 - press / sst, looRmse: Math.sqrt(press / n) };
}

export function quantile(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function pearson(a: number[], b: number[]): number | null {
  const n = a.length;
  if (n < 3 || n !== b.length) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let sab = 0, saa = 0, sbb = 0;
  for (let i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) ** 2; sbb += (b[i] - mb) ** 2; }
  return saa > 0 && sbb > 0 ? sab / Math.sqrt(saa * sbb) : null;
}

/** Predicción de cada año con un modelo ajustado SIN ese año (validación retrospectiva). */
export function looPredictions(X: number[][], y: number[]): (number | null)[] {
  return y.map((_, i) => {
    const c = ols(X.filter((_, k) => k !== i), y.filter((_, k) => k !== i));
    return c ? predict(c, X[i]) : null;
  });
}

/**
 * Años análogos: para el año i, los k años más parecidos (distancia euclídea sobre variables estandarizadas
 * con la media y desvío de los OTROS años) y la predicción es el promedio de su aporte.
 */
export function analogPredict(Xtrain: number[][], ytrain: number[], x: number[], k = 5): { pred: number; years: number[] } | null {
  if (Xtrain.length < k + 2) return null;
  const p = x.length;
  const mu = Array.from({ length: p }, (_, j) => Xtrain.reduce((a, r) => a + r[j], 0) / Xtrain.length);
  const sd = Array.from({ length: p }, (_, j) => Math.sqrt(Xtrain.reduce((a, r) => a + (r[j] - mu[j]) ** 2, 0) / Xtrain.length) || 1);
  const d = Xtrain.map((r, i) => ({ i, d: Math.sqrt(r.reduce((a, v, j) => a + ((v - x[j]) / sd[j]) ** 2, 0)) }));
  d.sort((a, b) => a.d - b.d);
  const near = d.slice(0, k).map((z) => z.i);
  return { pred: near.reduce((a, i) => a + ytrain[i], 0) / k, years: near };
}

export interface Skill { n: number; mae: number; mape: number; bias: number; sdErr: number; rmse: number; coverage80: number | null }

/** Métricas de validación retrospectiva a partir de predicciones fuera de muestra. `halfWidth` = medio ancho del intervalo. */
export function skill(y: number[], pred: (number | null)[], halfWidth: number | null): Skill | null {
  const e: number[] = [], rel: number[] = [];
  let inside = 0;
  y.forEach((v, i) => {
    const p = pred[i];
    if (p == null) return;
    e.push(p - v);
    if (v > 0) rel.push(Math.abs(p - v) / v);
    if (halfWidth != null && Math.abs(p - v) <= halfWidth) inside++;
  });
  const n = e.length;
  if (n < 5) return null;
  const bias = e.reduce((a, b) => a + b, 0) / n;
  return {
    n,
    mae: e.reduce((a, b) => a + Math.abs(b), 0) / n,
    mape: rel.length ? rel.reduce((a, b) => a + b, 0) / rel.length : NaN,
    bias,
    sdErr: Math.sqrt(e.reduce((a, b) => a + (b - bias) ** 2, 0) / Math.max(1, n - 1)),
    rmse: Math.sqrt(e.reduce((a, b) => a + b * b, 0) / n),
    coverage80: halfWidth != null ? inside / n : null,
  };
}
