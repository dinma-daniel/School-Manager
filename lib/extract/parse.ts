import type { SchoolInfo } from "../schema";
import { ExtractionError } from "./types";

/**
 * Turning a model's reply into a SchoolInfo.
 *
 * Claude returns schema-valid JSON, but smaller models wrap it in markdown
 * fences, add a sentence of preamble, leave fields out, or write "N/A" where
 * the schema asks for null. A strict parse would throw away an otherwise good
 * answer over any one of those, so this repairs what it safely can and only
 * gives up when there's genuinely no object to read.
 */

/** Values small models write when they mean "the pages didn't say". */
const NULL_WORDS = new Set([
  "",
  "n/a",
  "na",
  "none",
  "null",
  "unknown",
  "not specified",
  "not stated",
  "not mentioned",
  "not provided",
  "not available",
  "not applicable",
  "unspecified",
  "tbd",
  "-",
  "—",
]);

/** Pull the JSON object out of a reply that may be wrapped in prose or fences. */
export function extractJsonObject(raw: string): unknown {
  let text = raw.trim();

  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();

  const start = text.indexOf("{");
  if (start === -1) {
    throw new ExtractionError("The model replied with no JSON at all. Try a different model.");
  }

  // Walk to the matching close brace so trailing commentary is ignored.
  let depth = 0;
  let inString = false;
  let escaped = false;
  let end = -1;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === "{") depth++;
    if (ch === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }

  const candidate = end === -1 ? text.slice(start) : text.slice(start, end);
  try {
    return JSON.parse(candidate);
  } catch {
    throw new ExtractionError(
      "The model's reply wasn't valid JSON. A larger model, or one with a bigger context window, usually fixes this.",
    );
  }
}

function asString(value: unknown): string | null {
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return NULL_WORDS.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Money fields, where "None" is an answer rather than a gap: "tuition fees per
 * semester: None" means the course is free. Treating it as missing would show
 * a free course as one whose fees are unknown — the opposite of the truth.
 */
function asCost(value: unknown): string | null {
  if (typeof value === "string" && /^(none|free|no fees?|nil|0|£0|€0|\$0)\.?$/i.test(value.trim())) {
    return "None — no charge";
  }
  return asString(value);
}

function asText(value: unknown, fallback = ""): string {
  return asString(value) ?? fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asStringList(value: unknown): string[] {
  return asArray(value)
    .map((item) => (typeof item === "object" && item !== null ? asString(Object.values(item)[0]) : asString(item)))
    .filter((item): item is string => item !== null);
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

/**
 * Coerce whatever came back into the shape the UI renders, dropping entries
 * too empty to be worth showing rather than rendering blank rows.
 */
export function normalizeSchoolInfo(value: unknown): SchoolInfo {
  const raw = record(value);
  const costs = record(raw.costs);

  const info: SchoolInfo = {
    name: asText(raw.name, "Untitled school"),
    programme: asString(raw.programme),
    level: asString(raw.level),
    location: asString(raw.location),
    summary: asText(raw.summary),
    applyVia: asString(raw.applyVia),
    applyUrl: asString(raw.applyUrl),

    steps: asArray(raw.steps)
      .map((item) => {
        const step = record(item);
        return { title: asText(step.title), detail: asText(step.detail) };
      })
      .filter((step) => step.title || step.detail),

    deadlines: asArray(raw.deadlines)
      .map((item) => {
        const d = record(item);
        const iso = asString(d.iso);
        return {
          label: asText(d.label, "Deadline"),
          date: asText(d.date),
          // Only keep a date we can actually put on a calendar.
          iso: iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null,
          notes: asString(d.notes),
        };
      })
      .filter((d) => d.date || d.iso),

    intakes: asArray(raw.intakes)
      .map((item) => {
        const d = record(item);
        const iso = asString(d.iso);
        return {
          label: asText(d.label, "Classes start"),
          date: asText(d.date),
          iso: iso && /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null,
        };
      })
      .filter((d) => d.date || d.iso),

    requirements: asArray(raw.requirements)
      .map((item) => {
        const group = record(item);
        return { category: asText(group.category, "Requirements"), items: asStringList(group.items) };
      })
      .filter((group) => group.items.length > 0),

    costs: {
      applicationFee: asCost(costs.applicationFee),
      tuition: asCost(costs.tuition),
      living: asString(costs.living),
      notes: asString(costs.notes),
    },

    scholarships: asArray(raw.scholarships)
      .map((item) => {
        const s = record(item);
        return {
          name: asText(s.name),
          amount: asString(s.amount),
          eligibility: asString(s.eligibility),
          deadline: asString(s.deadline),
          url: asString(s.url),
        };
      })
      .filter((s) => s.name),

    contactEmail: asString(raw.contactEmail),
    contactPhone: asString(raw.contactPhone),
    contactUrl: asString(raw.contactUrl),
    watchOuts: asStringList(raw.watchOuts),
    notFound: asStringList(raw.notFound),
  };

  // A reply with no name and no content at all means the model didn't do the
  // job, however well-formed the JSON was.
  const hasSubstance =
    info.summary ||
    info.steps.length ||
    info.deadlines.length ||
    info.requirements.length ||
    info.scholarships.length;

  if (!hasSubstance) {
    throw new ExtractionError(
      "The model returned an empty brief. The page may not have loaded, or the model's context window may be too small for it.",
    );
  }

  return info;
}
