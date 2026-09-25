const UA = "rio-colorado-monitor/1.0 (monitoreo personal; respuestas cacheadas varias horas)";

/** GET con timeout. Devuelve null si falla (red, timeout o HTTP != 2xx). */
export async function get(url: string, kind: "text" | "json", ms = 8500, headers: Record<string, string> = {}): Promise<any | null> {
  const ctl = new AbortController();
  const to = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "user-agent": UA, ...headers }, signal: ctl.signal });
    if (!r.ok) return null;
    return kind === "json" ? await r.json() : await r.text();
  } catch {
    return null;
  } finally {
    clearTimeout(to);
  }
}

export function json(body: unknown, status: number, cdn: string, browser = "public, max-age=600") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": status === 200 ? browser : "no-store",
      "netlify-cdn-cache-control": status === 200 ? cdn : "no-store",
    },
  });
}
