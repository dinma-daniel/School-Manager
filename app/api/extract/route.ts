import { eventStream } from "@/lib/events";
import { ExtractionError, getExtractor } from "@/lib/extract";
import { keepKnownLinks } from "@/lib/extract/links";
import { gatherPages, ScrapeError } from "@/lib/scrape";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  let url: string;
  try {
    const body = await request.json();
    url = typeof body?.url === "string" ? body.url : "";
  } catch {
    return Response.json({ error: "Bad request body." }, { status: 400 });
  }
  if (!url) return Response.json({ error: "No link given." }, { status: 400 });

  // Backend selection can fail on its own (an unknown EXTRACTOR value), and
  // that's a config error worth reporting before anything is fetched.
  let extractor;
  try {
    extractor = getExtractor();
  } catch (err) {
    const message = err instanceof ExtractionError ? err.message : "Extraction backend is misconfigured.";
    return Response.json({ error: message }, { status: 500 });
  }

  return eventStream(
    async (progress) => {
      const corpus = await gatherPages(url, {
        maxChars: extractor.maxChars,
        maxPages: extractor.maxPages,
        onProgress: progress,
      });

      progress(`Reading it with ${extractor.name}`);
      const raw = await extractor.extract(corpus.text, corpus.pagesRead.length, progress);
      const info = keepKnownLinks(raw, corpus.text, corpus.pagesRead);

      return { info, pagesRead: corpus.pagesRead, truncated: corpus.truncated };
    },
    (err) => (err instanceof ScrapeError || err instanceof ExtractionError ? err.message : null),
  );
}
