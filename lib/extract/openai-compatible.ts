import * as z from "zod/v4";
import { SchoolInfoSchema } from "../schema";
import { buildUserMessage, JSON_REMINDER, SYSTEM } from "./prompt";
import { extractJsonObject, normalizeSchoolInfo } from "./parse";
import { ExtractionError, type Extractor } from "./types";
import { condense } from "../scrape";

/**
 * Anything speaking the OpenAI chat API — which is most of the free options:
 * Hugging Face Inference Providers, Groq, OpenRouter, Together, LM Studio,
 * llama.cpp's server, vLLM, and Ollama's own /v1 endpoint.
 *
 * Point EXTRACTOR_BASE_URL at the endpoint and EXTRACTOR_MODEL at the model:
 *
 *   Hugging Face  https://router.huggingface.co/v1
 *   Groq          https://api.groq.com/openai/v1
 *   OpenRouter    https://openrouter.ai/api/v1
 *   LM Studio     http://localhost:1234/v1
 */
/** Whether an endpoint+model pair accepts json_schema, learned on first use. */
const schemaSupport = new Map<string, boolean>();

export function openAiCompatibleExtractor(): Extractor {
  const baseUrl = (process.env.EXTRACTOR_BASE_URL ?? "").replace(/\/$/, "");
  const model = process.env.EXTRACTOR_MODEL ?? "";
  const apiKey = process.env.EXTRACTOR_API_KEY ?? "";
  // Free tiers meter tokens per minute, and that — not the model's context
  // window — is usually what limits how much of a page can be read. Groq's
  // free tier allows roughly 24k characters per request; the default leaves
  // room for the schema and the reply on top.
  const maxChars = Number(process.env.EXTRACTOR_MAX_CHARS ?? 16_000);
  const maxPages = Number(process.env.EXTRACTOR_MAX_PAGES ?? 2);

  return {
    name: `${host(baseUrl)} · ${model || "(no model set)"}`,
    maxChars,
    maxPages,

    async extract(corpusText, pageCount, onProgress) {
      if (!baseUrl || !model) {
        throw new ExtractionError(
          "Set EXTRACTOR_BASE_URL and EXTRACTOR_MODEL in .env.local to use this backend.",
        );
      }

      // Can shrink if the provider says a request is too big; see below.
      const memoKey = `${baseUrl}|${model}`;
      const fits = fitsMemo.get(memoKey);
      let corpus = fits && corpusText.length > fits ? condense(corpusText, fits) : corpusText;
      const body = () => ({
        model,
        temperature: 0,
        // Covers the brief (~2-3k tokens) plus the thinking that reasoning
        // models do first. Kept at 8000 because that's the output ceiling on
        // several free models, and going over is a hard 400.
        max_tokens: Number(process.env.EXTRACTOR_MAX_TOKENS ?? 8_000),
        messages: [
          { role: "system", content: `${SYSTEM}\n\n${JSON_REMINDER}` },
          { role: "user", content: buildUserMessage(corpus, pageCount) },
        ],
      });

      const schemaFormat = {
        type: "json_schema",
        json_schema: {
          name: "school_info",
          strict: true,
          schema: z.toJSONSchema(SchoolInfoSchema),
        },
      };

      async function send(useSchema: boolean) {
        try {
          return await fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
            },
            body: JSON.stringify(useSchema ? { ...body(), response_format: schemaFormat } : body()),
            signal: AbortSignal.timeout(Number(process.env.EXTRACTOR_TIMEOUT_MS ?? 180_000)),
          });
        } catch (err) {
          if (err instanceof Error && err.name === "TimeoutError") {
            throw new ExtractionError("The model took too long to reply.");
          }
          throw new ExtractionError(`Couldn't reach ${host(baseUrl)}. Check EXTRACTOR_BASE_URL.`);
        }
      }

      // Schema-constrained decoding is the reliable path, but plenty of free
      // models don't offer it (Groq's compound models, much of OpenRouter).
      // Ask for it, and on a refusal fall back to the prompt alone — which is
      // what JSON_REMINDER and parse.ts exist to make survivable.
      //
      // The answer is remembered per model: retrying a refusal every time
      // would double both the latency and the token spend, and free tiers
      // meter tokens per minute.
      const setting = process.env.EXTRACTOR_JSON_SCHEMA ?? "auto";
      const wantSchema =
        setting === "off" ? false : setting === "on" ? true : (schemaSupport.get(memoKey) ?? true);

      async function sendOnce() {
        const useSchema =
          setting === "off" ? false : setting === "on" ? true : (schemaSupport.get(memoKey) ?? wantSchema);
        let response = await send(useSchema);

        if (!response.ok && useSchema && response.status === 400) {
          const detail = await response.clone().text().catch(() => "");
          if (/response.?format|json_schema|structured.output/i.test(detail)) {
            schemaSupport.set(memoKey, false);
            response = await send(false);
          }
        } else if (response.ok && useSchema) {
          schemaSupport.set(memoKey, true);
        }
        return response;
      }

      let response = await sendOnce();

      // Free tiers meter tokens per minute, and one brief is most of a
      // minute's allowance — so two reads close together routinely get "try
      // again in 41s". Waiting that out is better than failing: the page
      // stays open with a countdown and the read goes through.
      //
      // A 413 is the other side of the same meter: this one request is bigger
      // than a whole minute's allowance ("Limit 8000, Requested 8173"), so
      // waiting can't help. Pages full of addresses tokenize worse than the
      // character budget assumes. Trim the least relevant blocks by the
      // overshoot, with a margin, and send again.
      //
      // Each kind of trouble gets its own retries, so a trim and a hiccup
      // don't use up the waits a busy minute needs.
      const retries = { busy: 0, trim: 0, hiccup: 0 };
      let attempts = 1;
      while (true) {
        const detail = await response.clone().text().catch(() => "");
        if (serverHiccup(response.status) && retries.hiccup < MAX_RETRIES) {
          // The provider's own outage (a 502, Cloudflare's 520). These clear
          // in seconds far more often than not.
          retries.hiccup++;
          attempts++;
          await waitOut(5_000, onProgress, "The AI service had a hiccup on its end");
        } else if (response.status === 413 && retries.trim < MAX_RETRIES && overshoot(detail) !== null) {
          retries.trim++;
          attempts++;
          corpus = condense(corpus, Math.floor(corpus.length * overshoot(detail)! * 0.85));
          onProgress?.("That was a bit long for the AI service — trimming the least useful parts and trying again");
        } else if (response.status === 429 && retries.busy < MAX_RETRIES) {
          const limit = rateLimit(response, detail);
          if (limit.daily || limit.waitMs === null || limit.waitMs > MAX_WAIT_MS) break;
          retries.busy++;
          attempts++;
          await waitOut(limit.waitMs, onProgress);
        } else {
          break;
        }
        response = await sendOnce();
      }
      // Remember what fitted, so the next brief is trimmed before it's sent
      // rather than after a refusal.
      if (response.ok && corpus.length < corpusText.length) fitsMemo.set(memoKey, corpus.length);

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        if (response.status === 401 || response.status === 403) {
          throw new ExtractionError("That endpoint rejected the key. Check EXTRACTOR_API_KEY.");
        }
        if (response.status === 429) {
          // The provider's own words go to the server log, for whoever runs
          // the app. The person reading gets what to do and when.
          console.error(`rate limited by ${host(baseUrl)} after ${attempts} attempt(s):`, providerMessage(detail));
          throw new ExtractionError(rateLimitMessage(rateLimit(response, detail), attempts));
        }
        if (response.status === 413) {
          console.error(
            `request too large for ${host(baseUrl)} even after trimming — consider lowering EXTRACTOR_MAX_CHARS:`,
            providerMessage(detail),
          );
          throw new ExtractionError(
            "These pages are too long for the AI service to read in one go. Try the course's own page rather than an overview.",
          );
        }
        if (serverHiccup(response.status)) {
          console.error(`${host(baseUrl)} returned ${response.status} after ${attempts} attempt(s)`);
          throw new ExtractionError("The AI service is having trouble on its end. Try again in a few minutes.");
        }
        throw new ExtractionError(
          `${host(baseUrl)} returned ${response.status}. ${providerMessage(detail)}`,
        );
      }

      const payload = (await response.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new ExtractionError("The endpoint returned an empty reply.");

      return normalizeSchoolInfo(extractJsonObject(content));
    },
  };
}

/** Retries of each kind — waiting out a busy minute, trimming, a provider hiccup. */
const MAX_RETRIES = 2;
/** Corpus length that last fitted under the provider's per-request ceiling, per endpoint+model. */
const fitsMemo = new Map<string, number>();
/** Longer than this and we'd rather tell the user than hold the page open. */
const MAX_WAIT_MS = 90_000;

type RateLimit = {
  /** How long the provider asked us to wait, if it said. */
  waitMs: number | null;
  /** The day's allowance is gone — no point waiting a minute. */
  daily: boolean;
};

/** From "Limit 8000, Requested 8173": the fraction of the request that would have fit. */
function overshoot(detail: string): number | null {
  const m = detail.match(/limit\D{0,3}(\d+)\D{1,20}requested\D{0,3}(\d+)/i);
  if (!m) return null;
  const [limit, requested] = [Number(m[1]), Number(m[2])];
  return requested > limit ? limit / requested : null;
}

/** "1m30.5s", "41.699s", "2h3m", "850ms" → milliseconds. */
function parseDuration(text: string): number | null {
  let ms = 0;
  let matched = false;
  for (const [, n, unit] of text.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    matched = true;
    ms += Number(n) * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[unit as "ms" | "s" | "m" | "h"];
  }
  return matched ? ms : null;
}

/** What a 429 asks of us: the Retry-After header if sent, else "try again in …" from the body. */
function rateLimit(response: Response, detail: string): RateLimit {
  const header = Number(response.headers.get("retry-after"));
  const fromBody = detail.match(/try again in ([\d.hms]+)/i)?.[1];
  const waitMs = header > 0 ? header * 1_000 : fromBody ? parseDuration(fromBody) : null;
  return { waitMs, daily: /per day|\bTPD\b|\bRPD\b|daily/i.test(detail) };
}

/** "about 2 minutes", "about 3h 20m". */
function humanWait(ms: number): string {
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 1) return "about a minute";
  if (minutes < 60) return `about ${minutes} minutes`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `about ${h}h${m ? ` ${m}m` : ""}`;
}

function rateLimitMessage(limit: RateLimit, attempts: number): string {
  if (limit.daily) {
    return limit.waitMs
      ? `The AI service has used up today's free allowance. It resets in ${humanWait(limit.waitMs)} — try again then.`
      : "The AI service has used up today's free allowance. Try again tomorrow.";
  }
  if (limit.waitMs !== null && limit.waitMs > MAX_WAIT_MS) {
    return `The AI service is busy and asked for a break of ${humanWait(limit.waitMs)}. Try this one again after that.`;
  }
  if (attempts > 1) {
    return `The AI service is still busy after ${attempts} tries. Give it a minute, then try again.`;
  }
  return "The AI service is busy right now. Give it a minute, then try again.";
}

/** 5xx errors on the provider's side, Cloudflare's 52x included. */
const serverHiccup = (status: number) => status >= 500 && status <= 599;

/** Sit out a rate limit, counting down in the status line so the wait doesn't look like a hang. */
async function waitOut(
  ms: number,
  onProgress?: (message: string) => void,
  reason = "The AI service is busy",
) {
  // A little past the provider's figure: its clock and ours don't agree to the millisecond.
  const until = Date.now() + ms + 1_000;
  while (Date.now() < until) {
    const left = Math.ceil((until - Date.now()) / 1_000);
    onProgress?.(`${reason} — trying again in ${left}s`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(5_000, until - Date.now())));
  }
  onProgress?.("Trying again");
}

/** Pull the human-readable line out of an OpenAI-style error body. */
function providerMessage(detail: string): string {
  // An HTML error page from a proxy says nothing a reader can use.
  if (/^\s*<(!doctype|html|!--)/i.test(detail)) return "";
  try {
    const parsed = JSON.parse(detail);
    const message = parsed?.error?.message ?? parsed?.message;
    if (typeof message === "string") return message.slice(0, 300);
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return detail.slice(0, 300) || "No detail given.";
}

function host(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "endpoint";
  }
}
