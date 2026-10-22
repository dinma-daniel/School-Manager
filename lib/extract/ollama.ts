import * as z from "zod/v4";
import { SchoolInfoSchema } from "../schema";
import { buildUserMessage, JSON_REMINDER, SYSTEM } from "./prompt";
import { extractJsonObject, normalizeSchoolInfo } from "./parse";
import { ExtractionError, type Extractor } from "./types";

/**
 * A model running on your own machine through Ollama. Free, private, offline —
 * and slower and less accurate than a hosted model, especially on the long,
 * messy pages universities publish.
 *
 * Uses Ollama's native API rather than its OpenAI-compatible endpoint for one
 * reason: num_ctx. Ollama defaults every model to a 4096-token context no
 * matter what the model supports, and silently drops whatever doesn't fit —
 * which here means the half of the page with the deadlines in it. The native
 * API is the only way to raise it per request.
 */
export function ollamaExtractor(): Extractor {
  const host = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(/\/$/, "");
  const model = process.env.OLLAMA_MODEL ?? "qwen3:8b";
  const numCtx = Number(process.env.OLLAMA_NUM_CTX ?? 32768);

  // Leave room for the schema, the prompt and the model's own answer.
  const maxChars = Math.max(8_000, (numCtx - 6_000) * 3);

  return {
    name: `Ollama · ${model}`,
    maxChars,
    maxPages: 2,

    async extract(corpusText, pageCount) {
      const body = {
        model,
        stream: false,
        // Ollama takes a JSON Schema here and constrains sampling to match it.
        format: z.toJSONSchema(SchoolInfoSchema),
        options: {
          num_ctx: numCtx,
          temperature: 0,
        },
        messages: [
          { role: "system", content: `${SYSTEM}\n\n${JSON_REMINDER}` },
          { role: "user", content: buildUserMessage(corpusText, pageCount) },
        ],
      };

      let response: Response;
      try {
        response = await fetch(`${host}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          // Local models are slow; a small machine can genuinely take minutes.
          signal: AbortSignal.timeout(Number(process.env.OLLAMA_TIMEOUT_MS ?? 300_000)),
        });
      } catch (err) {
        if (err instanceof Error && err.name === "TimeoutError") {
          throw new ExtractionError(
            "The local model took too long. Try a smaller model, or raise OLLAMA_TIMEOUT_MS.",
          );
        }
        throw new ExtractionError(
          `Couldn't reach Ollama at ${host}. Is it running? Start it with "ollama serve".`,
        );
      }

      if (response.status === 404) {
        throw new ExtractionError(
          `Ollama doesn't have "${model}" downloaded. Run: ollama pull ${model}`,
        );
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new ExtractionError(`Ollama returned ${response.status}. ${detail.slice(0, 200)}`);
      }

      const payload = (await response.json()) as { message?: { content?: string } };
      const content = payload.message?.content;
      if (!content) throw new ExtractionError("Ollama returned an empty reply.");

      return normalizeSchoolInfo(extractJsonObject(content));
    },
  };
}
