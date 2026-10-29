import type { SavedSchool } from './schema';

/**
 * Sample schools, so the app can be opened, demonstrated and screenshotted
 * with no model, no key and no network at all.
 *
 * The institutions are real; the figures are illustrative and were NOT
 * extracted from their websites. Every entry is flagged `demo` and renders a
 * SAMPLE badge, so nothing here can be mistaken for a checked fact.
 *
 * Written for the 2026–27 cycle; `demoSchools()` moves them on a year at a
 * time so a sample never opens with its deadlines already gone.
 */
const DEMO_SCHOOLS: SavedSchool[] = [
  {
    id: "demo-sheffield",
    demo: true,
    sourceUrl: "https://www.sheffield.ac.uk/undergraduate/courses/2026/computer-science-bsc",
    pagesRead: [
      "https://www.sheffield.ac.uk/undergraduate/courses/2026/computer-science-bsc",
      "https://www.sheffield.ac.uk/undergraduate/fees-costs",
      "https://www.sheffield.ac.uk/undergraduate/apply",
    ],
    addedAt: "2026-01-01T00:00:00.000Z",
    truncated: false,
    status: "applying",
    note: "",
    info: {
      name: "University of Sheffield",
      programme: "Computer Science BSc",
      level: "Undergraduate",
      location: "Sheffield, United Kingdom",
      summary:
        "A three-year BSc in Computer Science starting September 2026. You apply through UCAS, the UK's central application service, rather than to the university directly — one form covers up to five courses.",
      applyVia: "UCAS",
      applyUrl: "https://www.ucas.com/",
      steps: [
        { title: "Register with UCAS", detail: "Create an account and get your personal ID. If you're at a school or college, use their UCAS buzzword so your application is linked to them." },
        { title: "Write your personal statement", detail: "One statement covers every course you apply to, so keep it about the subject rather than this university." },
        { title: "Add the course using code G402", detail: "Search by the UCAS code to make sure you pick the three-year BSc rather than the MComp." },
        { title: "Get your reference and pay the fee", detail: "A teacher or employer writes the reference inside UCAS. The application is not sent until the fee is paid." },
      ],
      deadlines: [
        { label: "UCAS equal consideration", date: "29 January 2027", iso: "2027-01-29", notes: "Applications after this are only considered if places remain." },
        { label: "Scholarship application", date: "31 March 2027", iso: "2027-03-31", notes: null },
        { label: "Accommodation guarantee", date: "31 July 2027", iso: "2027-07-31", notes: "Applies to first-year students who firmly accept." },
      ],
      intakes: [{ label: "Autumn intake", date: "September 2027", iso: null }],
      requirements: [
        { category: "Academic", items: ["A Levels: A*AA including Mathematics", "International Baccalaureate: 36 points, 6 in Higher Level Maths", "BTEC: D*DD in a relevant subject plus A in A Level Maths"] },
        { category: "English language", items: ["IELTS 6.5 overall with at least 6.0 in each component", "Accepted alternatives are listed on the English language requirements page"] },
        { category: "Documents", items: ["Personal statement", "One academic reference", "Transcripts of any completed qualifications"] },
      ],
      costs: {
        applicationFee: "£28.50 (UCAS fee for up to five choices)",
        tuition: "£9,535 per year (UK) · £30,940 per year (international)",
        living: "Around £10,000 per year including accommodation",
        notes: "A £200 deposit is required from international students on accepting an offer.",
      },
      scholarships: [
        { name: "Sheffield Undergraduate Merit Scholarship", amount: "£2,500 per year", eligibility: "Students achieving A*AA or above at A Level who are not in receipt of other university funding.", deadline: "31 March 2027", url: null },
        { name: "International Merit Scholarship", amount: "50% of tuition", eligibility: "Overseas fee-paying students with outstanding academic records.", deadline: "15 May 2027", url: "https://www.sheffield.ac.uk/undergraduate/fees-funding" },
      ],
      contactEmail: "ug.admissions@sheffield.ac.uk",
      contactPhone: "+44 114 222 8030",
      contactUrl: "https://www.sheffield.ac.uk/undergraduate/contact",
      watchOuts: [
        "The scholarship deadline is two months after the UCAS deadline but needs a separate form — applying to the course does not enter you for it.",
        "The three-year BSc (G402) and the four-year MComp (G403) are different UCAS codes; picking the wrong one is not easy to undo.",
      ],
      notFound: [
        "Whether an interview or admissions test is required for international applicants",
        "The deposit refund policy if a visa application is refused",
      ],
    },
  },
  {
    id: "demo-utaustin",
    demo: true,
    sourceUrl: "https://admissions.utexas.edu/apply/",
    pagesRead: ["https://admissions.utexas.edu/apply/", "https://admissions.utexas.edu/apply/freshman/", "https://admissions.utexas.edu/cost-aid/cost-tuition-rates/"],
    addedAt: "2026-01-01T00:00:00.000Z",
    truncated: true,
    status: "considering",
    note: "Need to check if the essay prompts have changed for this cycle.",
    info: {
      name: "University of Texas at Austin",
      programme: null,
      level: "Undergraduate",
      location: "Austin, Texas, United States",
      summary:
        "First-year admission to UT Austin runs through ApplyTexas or the Common App. Texas residents in the top 6% of their high school class are admitted automatically, but still have to submit the full application on time.",
      applyVia: "ApplyTexas or Common App",
      applyUrl: "https://www.applytexas.org/",
      steps: [
        { title: "Choose ApplyTexas or the Common App", detail: "Either is accepted and neither is preferred. Pick one and use it for the whole application." },
        { title: "Submit the application and the essay", detail: "One required essay plus three short answers. They are read together with your transcript." },
        { title: "Send your transcript and test scores", detail: "Your school sends the transcript directly. Test scores are optional for this cycle but are considered if sent." },
      ],
      deadlines: [
        { label: "Priority consideration", date: "November 1, 2026", iso: "2026-11-01", notes: "Also the honors programs deadline." },
        { label: "Regular deadline", date: "December 1, 2026", iso: "2026-12-01", notes: null },
        { label: "FAFSA priority date", date: "January 15, 2027", iso: "2027-01-15", notes: "For need-based aid consideration." },
      ],
      intakes: [{ label: "Fall semester", date: "August 2027", iso: null }],
      requirements: [
        { category: "Academic", items: ["Completion of the Recommended or Distinguished high school program", "Class rank in the top 6% guarantees admission for Texas residents"] },
        { category: "Documents", items: ["Official high school transcript", "One required essay and three short answers", "Two optional letters of recommendation"] },
      ],
      costs: {
        applicationFee: "$75 ($90 for international applicants)",
        tuition: "$11,752 per year (in-state) · $42,778 per year (out-of-state)",
        living: null,
        notes: "Fee waivers are available for applicants who qualify for the SAT or ACT fee waiver.",
      },
      scholarships: [
        { name: "Texas Advance Commitment", amount: "Full tuition covered", eligibility: "Texas families with an adjusted gross income under $100,000.", deadline: "January 15, 2027", url: null },
      ],
      contactEmail: "admissions@utexas.edu",
      contactPhone: null,
      contactUrl: "https://admissions.utexas.edu/contact/",
      watchOuts: [
        "Honors program applications close a month before the regular deadline and are part of the same form — you cannot add them later.",
      ],
      notFound: ["Deadlines for transfer applicants", "Whether the tuition figures include mandatory fees"],
    },
  },
];

/** The earliest deadline in the samples as written: UT Austin's priority date. */
const FIRST_DEADLINE = "2026-11-01";

/** Every year mentioned — dates, intakes, "starting September 2026", course addresses — moved on by `by`. */
function shiftYears<T>(value: T, by: number): T {
  if (by === 0) return value;
  return JSON.parse(JSON.stringify(value).replace(/\b(20\d\d)\b/g, (year) => String(Number(year) + by)));
}

/** The samples, moved on whole years until their first deadline is still ahead. */
export function demoSchools(today = new Date()): SavedSchool[] {
  const first = new Date(FIRST_DEADLINE);
  let by = 0;
  while (new Date(first).setFullYear(first.getFullYear() + by) < today.getTime()) by++;
  return shiftYears(DEMO_SCHOOLS, by);
}
