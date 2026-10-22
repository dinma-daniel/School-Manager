/**
 * Long jobs report progress as server-sent events: any number of `status`
 * lines, then one `done` or `error`. Both API routes and the client speak it
 * through these two helpers, so the framing lives in one place.
 */

export type StreamEvent =
  | { type: "status"; message: string }
  | { type: "done"; result: unknown }
  | { type: "error"; message: string; access?: Access };

/** A page that can't be read for a reason the user can act on — see AccessError in lib/scrape.ts. */
export type Access = { kind: "login" | "blocked"; url: string };

/** Duck-typed so this file stays free of server imports: it runs in the browser too. */
function accessOf(err: unknown): Access | undefined {
  const e = err as { kind?: unknown; url?: unknown };
  return (e?.kind === "login" || e?.kind === "blocked") && typeof e.url === "string" ? { kind: e.kind, url: e.url } : undefined;
}

/**
 * Server side: run `work`, streaming its progress. `explain` turns a thrown
 * error into the message the user sees, or null for an unexpected one.
 */
export function eventStream(
  work: (progress: (message: string) => void) => Promise<unknown>,
  explain: (err: unknown) => string | null,
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        const result = await work((message) => send({ type: "status", message }));
        send({ type: "done", result });
      } catch (err) {
        const message = explain(err);
        if (message === null) console.error("request failed:", err);
        send({ type: "error", message: message ?? "Something went wrong reading that page.", access: accessOf(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}

/** A failure worth showing to the user as-is — with `access` set when it's a login wall or a blocked site. */
export class StreamError extends Error {
  readonly access?: Access;
  constructor(message: string, access?: Access) {
    super(message);
    this.access = access;
  }
}

/** Client side: POST, relay status lines, resolve with the `done` result. */
export async function postForResult<T>(
  path: string,
  body: unknown,
  onStatus: (message: string) => void,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new StreamError("Couldn't reach the extractor. Is the dev server still running?");
  }

  // Failures before the stream opens come back as plain JSON.
  if (!response.body || !response.headers.get("content-type")?.includes("event-stream")) {
    const json = await response.json().catch(() => null);
    throw new StreamError(json?.error ?? "Couldn't reach the extractor.");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line; keep the partial tail.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const event = JSON.parse(line.slice(6)) as StreamEvent;
      if (event.type === "status") onStatus(event.message);
      else if (event.type === "error") throw new StreamError(event.message, event.access);
      else return event.result as T;
    }
  }

  // Stream ended without a verdict — a failure, not a spinner left up forever.
  throw new StreamError("The connection dropped before it finished.");
}
