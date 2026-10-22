import type { SchoolInfo } from "../schema";

export class ExtractionError extends Error {}

/**
 * A backend that turns page text into a typed brief.
 *
 * The app doesn't care which model does it — Claude, a model running on your
 * own machine, or anything behind an OpenAI-compatible endpoint. Each backend
 * declares how much text it can cope with, and the scraper collects to fit.
 */
export type Extractor = {
  /** Shown in errors and in the app's footer, e.g. "Ollama · qwen3:8b". */
  name: string;
  /** Total characters of page text this backend should be given. */
  maxChars: number;
  /** Linked pages to follow beyond the one the user pasted. */
  maxPages: number;
  /** `onProgress` reports anything worth showing while it works, such as waiting out a rate limit. */
  extract(corpusText: string, pageCount: number, onProgress?: (message: string) => void): Promise<SchoolInfo>;
};
