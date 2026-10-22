/**
 * Exchange rates for comparing tuition across currencies.
 *
 * From open.er-api.com: free, keyless, updated daily, and — unlike the ECB
 * feeds — it carries naira, cedi and shilling. Held in memory for half a day,
 * so a filter that's fiddled with all afternoon costs one request.
 */

export const runtime = "nodejs";

const SOURCE = "https://open.er-api.com/v6/latest/USD";
const KEEP_MS = 12 * 60 * 60 * 1000;

let cached: { rates: Record<string, number>; updated: string; at: number } | null = null;

export async function GET() {
  if (!cached || Date.now() - cached.at > KEEP_MS) {
    try {
      const res = await fetch(SOURCE, { signal: AbortSignal.timeout(10_000) });
      const body = await res.json();
      if (!res.ok || body?.result !== "success" || typeof body.rates !== "object") throw new Error("bad response");
      cached = { rates: body.rates, updated: body.time_last_update_utc ?? "", at: Date.now() };
    } catch {
      // Yesterday's rates beat none: fees don't move enough in a day to matter here.
      if (!cached) return Response.json({ error: "Exchange rates are unavailable right now." }, { status: 502 });
    }
  }
  return Response.json({ base: "USD", rates: cached.rates, updated: cached.updated });
}
