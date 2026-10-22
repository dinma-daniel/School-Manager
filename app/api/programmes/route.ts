import { eventStream } from "@/lib/events";
import { findProgrammes } from "@/lib/programmes";
import { ScrapeError } from "@/lib/scrape";

export const runtime = "nodejs";
export const maxDuration = 120;

/** List the programmes reachable from a school link. No model involved. */
export async function POST(request: Request) {
  let url: string;
  try {
    const body = await request.json();
    url = typeof body?.url === "string" ? body.url : "";
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400 });
  }
  if (!url) return Response.json({ error: "No link given." }, { status: 400 });

  return eventStream(
    (progress) => findProgrammes(url, progress),
    (err) => (err instanceof ScrapeError ? err.message : null),
  );
}
