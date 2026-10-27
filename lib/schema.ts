import * as z from "zod/v4";

/**
 * The shape we pull out of a school's admissions pages.
 *
 * Every field is required but nullable: structured outputs want a closed
 * schema, and a null tells us "the pages didn't say" — which we show to the
 * user rather than hide. Descriptions are load-bearing; they're the only
 * instructions the model gets about each field.
 */

export const DeadlineSchema = z.object({
  label: z.string().describe('What the date is for, e.g. "Regular decision", "UCAS equal consideration", "Scholarship application".'),
  date: z.string().describe('The date exactly as the page states it, e.g. "15 January 2027" or "Rolling admissions".'),
  iso: z.string().nullable().describe("The same date as YYYY-MM-DD if it is a single fixed calendar date, otherwise null."),
  notes: z.string().nullable().describe("Any caveat attached to it, e.g. applies to international applicants only. Null if none."),
});

export const IntakeSchema = z.object({
  label: z.string().describe('Which intake, e.g. "Autumn intake", "Winter term", "First semester".'),
  date: z.string().describe('When classes begin, exactly as the page states it, e.g. "September 2027" or "6 January 2028".'),
  iso: z.string().nullable().describe("The same date as YYYY-MM-DD if the page gives a single fixed day, otherwise null."),
});

export const StepSchema = z.object({
  title: z.string().describe("A short imperative step, e.g. \"Create an account on the applicant portal\"."),
  detail: z.string().describe("One or two plain-English sentences on what this step actually involves. No jargon the page didn't define."),
});

export const RequirementGroupSchema = z.object({
  category: z.string().describe('Grouping, e.g. "Academic", "English language", "Documents to upload", "Tests".'),
  items: z.array(z.string()).describe("Each specific requirement, kept concrete — include grades, scores and numbers where the page gives them."),
});

export const ScholarshipSchema = z.object({
  name: z.string(),
  amount: z.string().nullable().describe("What it's worth, as stated, e.g. \"Up to £5,000 per year\" or \"Full tuition\". Null if unstated."),
  eligibility: z.string().nullable().describe("Who can apply, in one sentence. Null if unstated."),
  deadline: z.string().nullable().describe("Application deadline as stated. Null if unstated."),
  url: z.string().nullable().describe("Direct link if one appears on the pages. Null otherwise."),
});

export const CostsSchema = z.object({
  applicationFee: z.string().nullable().describe("Cost to apply, including currency. Null if not stated or if free."),
  tuition: z.string().nullable().describe("Tuition per year, including currency. If domestic and international rates differ, give both."),
  living: z.string().nullable().describe("Estimated living costs per year if the pages state them."),
  notes: z.string().nullable().describe("Anything important about money that doesn't fit above — fee waivers, deposits, payment plans."),
});

export const SchoolInfoSchema = z.object({
  name: z.string().describe("The institution's name."),
  programme: z.string().nullable().describe("The specific course or programme, if the link was about one. Null if the link covers the school generally."),
  level: z.string().nullable().describe('Study level, e.g. "Undergraduate", "Master\'s", "PhD". Null if unclear.'),
  location: z.string().nullable().describe("City and country."),
  summary: z.string().describe("Two or three sentences: what this is and what applying to it actually involves. Write it for someone who has never applied anywhere before."),
  applyVia: z.string().nullable().describe('The system you apply through, e.g. "UCAS", "Common App", "the university\'s own portal". Null if unclear.'),
  applyUrl: z.string().nullable().describe("The most direct link to start or continue an application. Null if the pages never give one."),
  steps: z.array(StepSchema).describe("How to apply, in the order you do them. Include every step the pages mention, even administrative ones."),
  deadlines: z.array(DeadlineSchema).describe("Every date that matters, including scholarship and document deadlines."),
  intakes: z
    .array(IntakeSchema)
    .describe("When classes begin (the intake, term start or resumption date) — every intake the pages give. These are not deadlines; don't repeat them there. Empty array if the pages don't say."),
  requirements: z.array(RequirementGroupSchema).describe("What you need in order to be eligible, grouped."),
  costs: CostsSchema,
  scholarships: z.array(ScholarshipSchema).describe("Every scholarship, bursary, grant or fee waiver mentioned."),
  contactEmail: z.string().nullable(),
  contactPhone: z.string().nullable(),
  contactUrl: z.string().nullable().describe("An admissions enquiry or contact page. Null if none found."),
  watchOuts: z.array(z.string()).describe("Things that are easy to miss and cost people their application: separate deadlines, extra portals, documents that must be posted, tests booked months ahead. Empty array if genuinely none."),
  notFound: z.array(z.string()).describe("Important application information that these pages did NOT cover, so the user knows what they still have to look up. Be specific, e.g. \"English language test scores for non-EU applicants\"."),
});

export type SchoolInfo = z.infer<typeof SchoolInfoSchema>;
export type Deadline = z.infer<typeof DeadlineSchema>;
export type Intake = z.infer<typeof IntakeSchema>;
export type Scholarship = z.infer<typeof ScholarshipSchema>;

/** A saved entry: the extraction plus our own bookkeeping. */
export type SavedSchool = {
  id: string;
  sourceUrl: string;
  pagesRead: string[];
  addedAt: string;
  truncated: boolean;
  info: SchoolInfo;
  /** User's own tracking, not extracted. */
  status: "considering" | "applying" | "submitted" | "offer" | "rejected";
  note: string;
  /** Sample data, not extracted from the live site. Renders a SAMPLE badge. */
  demo?: boolean;
  /** The link whose programme list this was picked from — so it can be swapped for another from the same list. */
  pickedFrom?: string;
};

export const STATUS_LABELS: Record<SavedSchool["status"], string> = {
  considering: "Considering",
  applying: "Applying",
  submitted: "Submitted",
  offer: "Offer",
  rejected: "Closed",
};
