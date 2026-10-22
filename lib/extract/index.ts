import { claudeExtractor } from "./claude";
import { ollamaExtractor } from "./ollama";
import { openAiCompatibleExtractor } from "./openai-compatible";
import { ExtractionError, type Extractor } from "./types";

export { ExtractionError };
export type { Extractor };

export type BackendName = "ollama" | "openai" | "claude";

/**
 * Which model does the work, chosen by EXTRACTOR in .env.local.
 *
 * Defaults to Ollama: the only backend that costs nothing and needs no
 * account, so a fresh clone runs without anyone having to sign up for
 * anything. Set EXTRACTOR=claude or EXTRACTOR=openai to change it.
 */
export function getExtractor(): Extractor {
  const choice = (process.env.EXTRACTOR ?? "ollama").toLowerCase();

  switch (choice) {
    case "claude":
    case "anthropic":
      return claudeExtractor();
    case "openai":
    case "openai-compatible":
    case "huggingface":
    case "hf":
    case "groq":
    case "openrouter":
      return openAiCompatibleExtractor();
    case "ollama":
    case "local":
      return ollamaExtractor();
    default:
      throw new ExtractionError(
        `Unknown EXTRACTOR "${choice}". Use "ollama", "openai" or "claude".`,
      );
  }
}
