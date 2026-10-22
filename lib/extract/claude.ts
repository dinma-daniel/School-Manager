import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { SchoolInfoSchema } from "../schema";
import { buildUserMessage, SYSTEM } from "./prompt";
import { ExtractionError, type Extractor } from "./types";

/**
 * Claude. The most accurate backend and the only one that costs money —
 * roughly 2p a school on Haiku, or about ten times that on Opus.
 */
export function claudeExtractor(): Extractor {
  const model = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5";

  return {
    name: `Claude · ${model}`,
    maxChars: 120_000,
    maxPages: 4,

    async extract(corpusText, pageCount) {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new ExtractionError(
          "No ANTHROPIC_API_KEY set. Add it to .env.local, or switch EXTRACTOR to a free backend.",
        );
      }

      const client = new Anthropic();
      let response;
      try {
        response = await client.messages.parse({
          model,
          max_tokens: 16000,
          system: SYSTEM,
          output_config: { format: zodOutputFormat(SchoolInfoSchema) },
          messages: [{ role: "user", content: buildUserMessage(corpusText, pageCount) }],
        });
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError) {
          throw new ExtractionError("That API key was rejected. Check ANTHROPIC_API_KEY in .env.local.");
        }
        if (err instanceof Anthropic.RateLimitError) {
          throw new ExtractionError("Rate limited by the API — wait a moment and try again.");
        }
        if (err instanceof Anthropic.APIError) {
          throw new ExtractionError(`The extraction service failed (${err.status}).`);
        }
        throw err;
      }

      if (response.stop_reason === "refusal") {
        throw new ExtractionError("The model declined to process that page.");
      }
      if (!response.parsed_output) {
        throw new ExtractionError(
          "Couldn't make sense of that page. It may be mostly images or behind a login.",
        );
      }
      return response.parsed_output;
    },
  };
}
