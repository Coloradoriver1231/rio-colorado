import { getStore } from "@netlify/blobs";

const store = () => getStore({ name: "rio-colorado" });

export async function readJson<T>(key: string): Promise<T | null> {
  try { return ((await store().get(key, { type: "json" })) as T) || null; } catch { return null; }
}
export async function writeJson(key: string, v: unknown): Promise<boolean> {
  try { await store().setJSON(key, v); return true; } catch { return false; }
}
