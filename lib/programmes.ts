/**
 * Finding the programmes a school offers, so the user can pick which ones to
 * read instead of pasting each course page by hand.
 *
 * Done without a model, on purpose. A course list is a page of links, and the
 * links that are programmes give themselves away: they come in long runs of
 * siblings under one courses-shaped path ("/programmes/undergraduate/189-
 * accounting-and-business", "/programmes/undergraduate/464-…"), usually with
 * a degree in the text ("Accounting and Business MA (Hons)"). That's cheap to
 * spot, works the same on every backend, and leaves the model's budget for
 * reading the programmes the user actually chose.
 *
 * The pasted link might be the course list, a homepage several clicks above
 * it, one page of a paginated list, or a course finder that renders with
 * JavaScript and has no links at all. So we read the page, step into
 * course-list pages it links to, walk pagination, and fall back to the site's
 * sitemap when the HTML comes up short.
 */

import {
  fetchPreferEnglish,
  getHtml,
  htmlToText,
  pageTitle,
  sameSite,
  siteKey,
  ScrapeError,
  stripChrome,
  stripFooter,
  validateUrl,
} from "./scrape";
import { looksScripted, renderPage } from "./render";

export type Programme = {
  name: string;
  url: string;
  /** "Undergraduate", "Postgraduate" or "Research", when the name or URL says. */
  level: string | null;
  /** Every level it spans — more than one for "(MEng/MSc/BEng/BSc)". Falls back to `level`. */
  levels?: string[];
  /** Named from its web address (a sitemap entry, a "Read more" link), so the name is a best guess. */
  nameFromUrl: boolean;
};

export type ProgrammeList = {
  school: string | null;
  programmes: Programme[];
  pagesSearched: string[];
  /** The pasted link is itself one course's page — reading it is probably what the user wants. */
  startIsProgramme: boolean;
};

/** Below this, keep looking — a homepage's "featured courses" isn't the list. */
const ENOUGH = 15;
/** Below this, also check the sitemap. */
const SITEMAP_BELOW = 100;
/** Course-list pages to open at each step away from the pasted link. */
const HUBS_PER_STEP = 4;
// Four: washington.edu → Graduate School → Find a Program → the finder itself.
const HUB_STEPS = 4;
/** Every HTML page we fetch, hubs and pagination together. Politeness, and time. */
const FETCH_BUDGET = 30;
const MAX_RESULTS = 1_200;
const SITEMAP_BYTES = 8_000_000;
/** Pages to open in a browser, for lists built with JavaScript. Each takes seconds. */
const RENDER_BUDGET = 3;
/** Section sitemaps to try: the pasted link's section and those of the best course lists. */
const MAX_SECTIONS = 3;
/** A path segment that's a language folder ("/fr/", "/zh-hans/"), not part of the site's structure. */
const LANGUAGE_SEGMENT = /^(fr|de|es|it|pt|nl|zh|ja|ko|ar|ru|pl|sv|da|fi|nb|no|tr)(-[a-z]{2,4})?$/;

const DEGREE_TEXT =
  /\b(B\.?A|B\.?Sc|B\.?S|BEng|BMus|BEd|BBA|BFA|BArch|BDS|BN|AB|LLB|MBChB|MBBS|MEng|MSci|MMath|MPhys|MChem|MBiol|MInf|MArch|M\.?Sc|M\.?S|M\.?A|MBA|MFA|MEd|EdM|MPA|MPP|MSW|MPhil|MRes|MPH|LLM|PGCE|PGDip|PGCert|PG ?Dip|PG ?Cert|PhD|DPhil|EdD|DBA|DNP|DPT|MD|JD|HND|HNC|MLitt|MMus|MTh|MFin|MAcc|BFin|PGDE|EngD|DClinPsy|DMA|CAGS|Bachelor(?:studium|studien|s)?|Master(?:studium|studien|s)?|Doctor(ate)?|Diploma|Licence|Laurea|Diplomstudium|Doktoratsstudium|Doktorat|Grado|Máster|Licenciatura)\b/;

/*
 * Other languages. A sample of a thousand universities across 200 countries
 * showed English-only vocabulary was the biggest single gap: Tec de
 * Monterrey's course lists are "Oferta educativa" and "Maestrías", French
 * ones are "Formations", Italian "Corsi di laurea". Unicode-aware, since \b
 * means nothing to Cyrillic, and kept apart from the English patterns above
 * so those stay readable.
 */
const L = String.raw`(?<![\p{L}\p{N}])`; // start of a word, in any script
const R = String.raw`(?![\p{L}\p{N}])`; // end of one

/** Degree names that aren't English. */
const DEGREE_INTL = new RegExp(
  `${L}(${[
    // Spanish, Portuguese
    "Maestr[ií]as?", "Doctorados?", "Licenciad[oa]", "Ingenier[ií]a", "Especializaci[oó]n", "Tecnicaturas?",
    "Mestrados?", "Doutorados?", "Bacharelado", "Licenciaturas", "Tecn[oó]logo",
    // French, Italian, Dutch
    "Licence", "Master", "Doctorat", "BUT", "BTS", "DUT", "Laurea(?: magistrale| triennale)?", "Dottorato",
    // Central/Eastern Europe, Turkey, Indonesia/Malaysia
    "Licencjat", "Magisterium", "In[żz]ynier", "Magister", "Lisans", "Y[üu]ksek Lisans", "Doktora",
    "Sarjana", "Diploma", "Ijazah Sarjana(?: Muda)?", "Pregrado",
    // Russian, Ukrainian
    "Бакалавр\\p{L}*", "Магистр\\p{L}*", "Магістр\\p{L}*", "Специалитет", "Аспирантур\\p{L}*", "Аспірантур\\p{L}*",
  ].join("|")})${R}`,
  "u",
);

/** Whether a name says it's a degree, in any of the languages we know. */
const namesDegree = (text: string) => DEGREE_TEXT.test(text) || DEGREE_INTL.test(text);

/** Links that lead towards a course list, in other languages. */
const HUB_INTL = new RegExp(
  `${L}(${[
    "oferta (acad[eé]mica|educativa|formativa)", "carreras", "licenciaturas", "grados", "posgrados?", "maestr[ií]as",
    "doctorados", "programas( acad[eé]micos| de \\p{L}+)?", "pregrado( y grado)?", "titulaciones", "estudios",
    "cursos( de (gradua[cç][aã]o|p[oó]s-gradua[cç][aã]o))?", "gradua[cç][aã]o", "p[oó]s-gradua[cç][aã]o", "mestrados", "doutorados",
    "formations?", "nos formations", "offre de formation", "catalogue des formations", "dipl[oô]mes", "cursus",
    "corsi( di (laurea|studio))?", "offerta (formativa|didattica)", "lauree", "dottorati",
    "opleidingen", "studieaanbod", "studiengänge", "studienangebot",
    "kierunki( studi[oó]w)?", "oferta (edukacyjna|dydaktyczna)", "studijn[ií] programy", "obory", "szakok", "képzések",
    "b[öo]l[üu]mler", "programlar", "akademik (birimler|programlar)",
    "program studi", "prodi", "pascasarjana", "program pengajian",
    "utbildningar", "uddannelser", "studietilbud",
    "направлени\\p{L}* подготовки", "специальности", "образовательные программы", "бакалавриат", "магистратура",
    "спеціальності", "освітні програми",
    "chương trình đào tạo", "ngành đào tạo",
  ].join("|")})${R}`,
  "iu",
);
/**
 * Faculty and school pages. Many universities list no programmes on the
 * homepage — they list faculties ("Wydział Matematyki i Informatyki",
 * "Faculdade de Ciências", "School of Theology"), and each faculty lists its
 * own. A route of last resort: opened only while better ones come up short.
 */
const FACULTY_TEXT = new RegExp(
  `^(${[
    // Not departments or institutes: those are research units, and there are dozens.
    "(faculty|school|college) of\\b", "(faculty|school|college) for\\b",
    "wydzia[łl]", "facultad( de)?", "faculdade( de)?", "facult[ée]( de| des| du)?", "facolt[àa]( di)?", "fakult[äa]t( f[üu]r)?",
    "fakultas", "fakulteti", "fakulte(si)?", "факультет", "інститут", "институт",
    "escuela( de)?", "escola( de)?", "[ée]cole( de| des| du)?", "scuola( di)?", "kolegij", "kolej",
    "دانشکده", "كلية", "学院", "学部", "단과대학",
  ].join("|")})`,
  "iu",
);

const isHubText = (text: string) => HUB_TEXT.test(text) || HUB_INTL.test(text) || FACULTY_TEXT.test(text);

/** A level's own landing page, in other languages — worth opening, like "Undergraduate". */
const LEVEL_HUB_INTL =
  /^(carreras|pregrado|licenciaturas|grados|posgrados?|maestr[ií]as|doctorados|gradua[cç][aã]o|p[oó]s-gradua[cç][aã]o|mestrados|doutorados|licences?|masters?|lauree( magistrali)?|dottorati|бакалавриат|магистратура|аспирантура|sarjana|pascasarjana|lisans|lisansüstü|yüksek lisans)(?![\p{L}])/iu;

/** Link text naming a page *about* courses, in other languages — "Carreras", "Formations". */
const GENERIC_INTL = new RegExp(
  `^(${[
    "carreras", "licenciaturas", "grados", "posgrados?", "maestr[ií]as", "doctorados", "programas", "oferta (acad[eé]mica|educativa)",
    "cursos", "gradua[cç][aã]o", "p[oó]s-gradua[cç][aã]o", "formations?", "licences?", "masters", "doctorats?",
    "corsi", "lauree", "opleidingen", "studia", "kierunki", "programlar", "b[öo]l[üu]mler", "fakultas", "program studi",
    // Cookie banners: "Allow all", "Essential only"…
    "(allow|accept|reject|deny) (all|cookies)( cookies)?", "accept", "decline", "essential only", "(only )?necessary( only)?", "(cookie|privacy) settings", "manage cookies",
  ].join("|")})$`,
  "iu",
);

const isGeneric = (text: string) => GENERIC_TEXT.test(text) || GENERIC_INTL.test(text);

/** Words that, with degree codes, make up a link like "BA-to-MA" or "GRAD Cert". */
const CREDENTIAL_WORDS = /\b(minor|major|grad(uate)?|cert(ificate)?|diploma|concentration|track|to|and|online|dual|part[- ]time|full[- ]time)\b/gi;

/**
 * A link that names only the credential — "BA", "minor", "MA/MBA" — with the
 * subject written beside it, as in "Italian Studies (BA, minor)".
 */
function credentialOnly(text: string): boolean {
  if (text.length > 24) return false;
  // Degree codes we don't list by name — BU's MSD, DScD, MAT, BLS, "UND Cert" —
  // are short, capitalised at both ends, and stand alone as the link's text.
  if (/^[A-Z][A-Za-z]{0,4}[A-Z](?: Cert)?$/.test(text)) return true;
  const rest = text
    .replace(new RegExp(DEGREE_TEXT.source, "g"), "")
    .replace(CREDENTIAL_WORDS, "")
    .replace(/[^a-z]/gi, "");
  return rest.length <= 2 && (DEGREE_TEXT.test(text) || new RegExp(CREDENTIAL_WORDS.source, "i").test(text));
}

/** The subject a credential-only link belongs to: the start of its list item or table row. */
function subjectBefore(html: string, at: number): string | undefined {
  const before = html.slice(Math.max(0, at - 600), at);
  const openers = [...before.matchAll(/<(li|tr|p|dt|h[1-6])\b/gi)];
  const last = openers.at(-1);
  if (last?.index === undefined) return undefined;
  const subject = htmlToText(before.slice(last.index))
    .replace(/\s+/g, " ")
    .split("(")[0]
    .replace(/^[\s|•#]+|[\s|,:;–-]+$/g, "")
    .trim();
  return subject.length >= 3 && subject.length <= 100 ? subject : undefined;
}

/** Path segments under which programme pages reliably live. */
const STRONG_SEGMENT =
  // "(…-)" takes in compounds: "doctoralphd-programmes", "find-your-degree-programme".
  // Degree-named folders too: Harbour.space files its masters at /barcelona/master/computer-science.
  /^((?:[a-z]+-)*(?:courses?|programmes?|programs?|degrees?|majors?)|course-?finder|masters?|bachelors?|phd|(?:[a-z]+-)*(?:programas?|carreras?|pregrado|cursos?|formations?|corsi|lauree|opleidingen|kierunki|titulaciones|licenciaturas|posgrados?|maestrias|doctorados|grados|graduacao|pos-graduacao|mestrados?|doutorados?|programlar|bolumler|prodi|program-studi)|studiengaenge|studiengang|studienangebot|bachelorstudien|masterstudien|doktoratsstudien|bachelor-und-diplomstudien)$/i;
/** Segments programme pages often sit under, alongside much that isn't one. */
const WEAK_SEGMENT = /^(study|studies|studying|studium|undergraduate|postgraduate|graduate|subjects?|ug|pg)$/i;

/** Last path segments that are pages *about* courses, not courses. */
const GENERIC_SLUG =
  /^(index(\.\w+)?|search|results|a-?z|a-to-z|.*-a-?z|all|list|apply|how-to-apply|applying|fees?|fees-and-funding|funding|finance|scholarships?|bursaries|entry-requirements|requirements|international|faqs?|contact(-us)?|contacts|open-days?|visit|accommodation|careers?|news|events?|overview|modules|structure|teaching|assessment|why-.*|life|about|login|help|clearing|by-.+|.*-(courses|programmes|programs|degrees|subjects)|(.+-)?(registration|absence|proof|regulations?|guidelines|forms?|downloads?|faqs?|areas?|topics?|themes?))$/i;

/** Anchor text that names a page about courses rather than a course. */
const GENERIC_TEXT =
  /^((all|our|browse|view|see|search|find|explore|discover)\b.*|apply( now| online)?|how to apply|fees?( and funding)?|tuition( fees)?|funding|scholarships?|entry requirements|requirements|contact( us)?|search|more|news|events?|open days?|log ?in|sign in|accommodation|careers?|about( us)?|home|back|next|previous|undergraduate|postgraduate|graduate|research|international|courses|programmes|programs|degrees|subjects|majors|study|study with us|a-z|a to z|(bachelor|master|doctor)('?s|’s)?( degrees?| study| programmes?| programs?| courses?)?|phd( study)?|foundation( year)?|[a-z]|\d+)$/i;

/** Course cards whose only link says this — the name is in the URL instead. In the common languages too. */
const READ_MORE =
  /^((read|learn|find out|discover|see|view) more|more( info(rmation)?| details)?|details|view (course|programme|program)( details)?|(course|programme|program) details|ver (m[aá]s|carrera|programa|detalles?)|leer m[aá]s|conoce m[aá]s( sobre (el|la|este|esta) (programa|carrera|maestr[ií]a))?|m[aá]s informaci[oó]n|ir al programa|saiba mais|leia mais|ver curso|en savoir plus|voir (plus|la formation)|d[ée]couvrir|mehr erfahren|weiterlesen|mehr|scopri( di pi[uù])?|leggi (tutto|di pi[uù])|lees meer|meer info|czytaj wi[eę]cej|wi[eę]cej|подробнее|далее|selengkapnya|baca selengkapnya|devam[ıi]|detayl[ıi])\W*$/iu;

/** Links that lead towards a course list. */
const HUB_TEXT =
  /\b(courses|programmes|programs|degrees|majors|subjects)\b|course (finder|search|list)|\ba ?(to|[-‐‑–—]) ?z\b|what (can|to) (i |you )?study|^study( with us| at .*)?$|^(undergraduate|postgraduate|graduate)( study| studies| courses| programmes| programs| degrees| admissions)?$|^(admissions?|(future|prospective)( undergraduate| graduate)? students)$|studienangebot|studieng(ä|ae)nge|studium finden|studienprogramm|\b(bachelor|master|doktorats|diplom)studien\b|^studium$/i;

/** Links to the next page of the same list. */
const PAGER_TEXT = /^(\d{1,3}|next( page)?|more results|load more|[›»>]+)$/i;

/** Second-level labels under which a domain is registered: ed.ac.uk, unimelb.edu.au. */
function normalise(url: URL): string {
  const copy = new URL(url);
  copy.hash = "";
  const s = copy.toString();
  return s.endsWith("/") && copy.pathname !== "/" ? s.slice(0, -1) : s;
}

function segments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s).toLowerCase();
      } catch {
        return s.toLowerCase(); // a stray % in someone's URL
      }
    });
}

/**
 * The list a page belongs to: its parent path, with IDs and years wildcarded.
 * Manchester files each course under its own number
 * ("/courses/2027/07808/bsc-accounting"), so the literal parent is never
 * shared and the run of siblings would be invisible.
 */
const parentOf = (pathname: string) =>
  pathname
    .replace(/\/[^/]+\/?$/, "")
    .split("/")
    .map((s) => (/\d/.test(s) ? "*" : s))
    .join("/");

/**
 * Whether a path looks like one programme's page: a courses-shaped segment,
 * then at least one more that isn't a page about courses in general. `strict`
 * ignores the weak segments — needed for sitemaps, which list every page under
 * "/undergraduate/" and not just the courses.
 */
function programmePath(pathname: string, strict = false): boolean {
  const segs = segments(pathname);
  const at = segs.findIndex((s) => STRONG_SEGMENT.test(s) || (!strict && WEAK_SEGMENT.test(s)));
  if (at === -1 || at === segs.length - 1) return false;
  // "/programmes/undergraduate-subjects/history" is a subject, not a degree.
  if (segs.slice(at + 1, -1).some((s) => /(^|-)subjects?$/.test(s))) return false;
  // Continuing-education and CPD sections list one-off sittings, not degrees:
  // RCSI's "Advanced Trauma Life Support Provider — Cork / Dublin / Galway…".
  if (segs.some((s) => NOT_DEGREES.test(s))) return false;
  // A top-level research, international or exchange section isn't a list of
  // degrees (Özyeğin's /en/research/…-internship-program/…). Only at the top:
  // Glasgow files its PhDs under /postgraduate/research/.
  const top = segs.find((s) => !/^[a-z]{2}(-[a-z]{2})?$/.test(s));
  if (top && /^(research|international|exchange|partnerships?)$/.test(top)) return false;
  const last = segs[segs.length - 1].replace(/\.(html?|aspx?|php)$/, "");
  // A programme's own sub-pages: ".../thesis-program/admission-application-form-and-deadline".
  if (SUBPAGE.test(last)) return false;
  return last.length > 1 && !GENERIC_SLUG.test(last) && !/^\d+$/.test(last);
}

const NOT_DEGREES = new RegExp(
  "^(" +
    [
      "cpd", "short-courses?", "continuing-education", "executive-education-short-courses", "educacion-continua",
      "educacao-continuada", "formation-continue", "weiterbildung", "events?", "news", "noticias", "actualites", "blog",
      // Research and international offices run "programs" too — grants, exchanges,
      // competitions: Togliatti's /science-and-innovation/…/competitions-and-programs/,
      // Belarus's /international-activities/educational-programs/erasmus. Whole
      // folder names only, so "data-science" and "postgraduate-research" pass.
      "science(-and-innovation)?", "innovation", "research-and-innovation", "international-(activities|relations|cooperation|office)",
      "partnerships?", "grants?", "funding", "competitions?(-and-.+)?", "erasmus\\+?", "erasmus-.+", "mobility",
    ].join("|") +
    ")$",
  "i",
);
const SUBPAGE =
  /(^|-)(admissions?|application-(form|process|calend[ae]r|deadline)s?|announcements?|calend[ae]rs?|deadlines?|requirements|curriculum|faculty-members|staff|people|contacts?|news|events?|apply|how-to-apply|fees|tuition|scholarships?|regulations|forms|faqs?|internships?)(-|$)|^academic-program$/i;

/** Under a strong segment — enough, with siblings, to call a link a programme without a degree in its text. */
const strongPath = (pathname: string) => programmePath(pathname, true);

/**
 * The level the site files a page under, read from its address. The site's
 * own filing beats our reading of the name: an integrated "Architecture BA/MA"
 * filed under /undergraduate/ is undergraduate.
 */
function pathLevel(url: string): string | null {
  const path = new URL(url).pathname.toLowerCase();
  // [/-] so "/future-graduate-students/" counts, while "undergraduate" can't
  // be misread as "graduate". \w* takes in German compounds:
  // "/bachelor-und-diplomstudien/", "-masterstudium".
  if (/[/-](phd|doctoral\w*|doktorat\w*|research-degrees?|postgraduate-research|pgr|doctorados?|doutorados?|dottorat\w*|doktora|doctorat\w*|aspirantura)\b/.test(path)) {
    return "Research";
  }
  // Postgraduate first among the foreign words: "pos-graduacao" ends in "graduacao".
  if (/[/-](posgrados?|maestrias?|pos-graduacao|mestrados?|lauree?-magistral[ei]|magister|pascasarjana|yuksek-lisans|magistratura)\b/.test(path)) {
    return "Postgraduate";
  }
  if (/[/-](undergraduate|bachelor\w*|ug|licenciaturas?|grados?|graduacao|carreras|pregrado|licences?|lauree?-triennal[ei]|sarjana|lisans|bakalavr\w*)\b/.test(path)) {
    return "Undergraduate";
  }
  if (/[/-](postgraduate|graduate|master\w*|pg|pgt)\b/.test(path)) return "Postgraduate";
  return null;
}

// The same, in other languages, from a programme's name.
const RESEARCH_INTL = new RegExp(`${L}(Doctorado|Doutorado|Dottorato|Doktora|Doctorat|دکتری|دكتوراه|Аспирантур\\p{L}*|Аспірантур\\p{L}*)${R}`, "u");
const UG_INTL = new RegExp(
  `${L}(Licenciatura|Licenciad[oa]|Grado|Bacharelado|Licence|Laurea(?! magistrale)(?: triennale)?|Licencjat|In[żz]ynier|(?<!Y[üu]ksek )Lisans|Sarjana|Pregrado|Бакалавр\\p{L}*|BUT|DUT|BTS|Tecnicatura|Tecn[oó]logo|کارشناسی(?! ارشد)|بكالوريوس)${R}`,
  "u",
);
const PG_INTL = new RegExp(
  `${L}(Maestr[ií]a|Máster|Mestrado|Laurea magistrale|Magister(?:ium)?|Y[üu]ksek Lisans|Магистр\\p{L}*|Магістр\\p{L}*|Especializaci[oó]n|Pascasarjana|کارشناسی ارشد|ماجستير)${R}`,
  "u",
);

// What a name says about level. Only the degree words themselves — "Masterclass"
// and "Mastering" aren't degrees.
const RESEARCH_NAME = /\b(PhD|DPhil|EdD|DBA|Doctor(ate)?|MPhil|MRes|Doktorat\w*)\b/;
const UG_WORD = /\b(Bachelor(?:s|'s|’s|studium|studien)?|Grado|Licenciatura)\b/;
const PG_WORD = /\b(Master(?:s|'s|’s|studium|studien)?|Máster)\b/;
const UG_CODE = /\b(B\.?A|B\.?Sc|B\.?S|AB|BEng|BMus|BEd|BBA|BFA|BArch|LLB|MBChB|MBBS|Bachelor|Foundation|HND|HNC)\b/;
/** UK integrated masters: undergraduate entry, though the name says master. */
const INTEGRATED = /\b(MEng|MSci|MMath|MPhys|MChem)\b/;
// MD and JD are first degrees in name only; in the US you need a bachelor's to start one.
const PG_CODE = /\b(M\.?Sc|M\.?S|M\.?A|MBA|MFA|MEd|EdM|MPA|MPP|MSW|MPH|LLM|PGCE|PGDip|PGCert|PG ?Dip|PG ?Cert|Master|MD|JD|DNP|DPT)\b|\b[Gg]rad(uate)? [Cc]ert/;

export function levelOf(name: string, url: string): string | null {
  const filed = pathLevel(url);
  if (filed) return filed;
  if (RESEARCH_NAME.test(name) || RESEARCH_INTL.test(name)) return "Research";
  if (UG_WORD.test(name)) return "Undergraduate";
  if (PG_WORD.test(name)) return "Postgraduate";
  if (PG_INTL.test(name)) return "Postgraduate";
  if (UG_INTL.test(name)) return "Undergraduate";
  if (UG_CODE.test(name) || INTEGRATED.test(name)) return "Undergraduate";
  if (PG_CODE.test(name)) return "Postgraduate";
  return siteLevel(url);
}

/**
 * A graduate school's own site — grad.uw.edu, apply.grad.uw.edu — is all
 * postgraduate. Only where nothing else says otherwise: it lists the odd PhD.
 */
const GRAD_HOST = /(^|\.)(grad|graduate|gradschool|postgrad)\./i;

/** The level a page's place on the site implies, as a last resort. */
function siteLevel(url: string): string | null {
  const u = new URL(url);
  if (GRAD_HOST.test(u.hostname)) return "Postgraduate";
  if (MAJORS_PATH.test(u.pathname)) return "Undergraduate";
  return null;
}

/**
 * A major is an undergraduate thing in American usage, so a page filed under
 * /majors/ is one when nothing else says otherwise. UW's admissions site
 * (admit.washington.edu/majors/…) names no level anywhere else — not in its
 * addresses, titles or site name — and most of its majors are bare subjects.
 */
const MAJORS_PATH = /\/majors?\//i;

/**
 * Every level a programme spans. Harbour.space's "Computer Science
 * (MEng/MSc/BEng/BSc)" is both a bachelor's and a master's, and belongs under
 * both filters. Where the site files it under one level, that's the answer.
 */
export function levelsOf(name: string, url: string): string[] {
  const filed = pathLevel(url);
  if (filed) return [filed];
  const levels: string[] = [];
  const ug = UG_WORD.test(name) || UG_CODE.test(name) || UG_INTL.test(name);
  const pg = PG_WORD.test(name) || PG_CODE.test(name) || PG_INTL.test(name);
  // An integrated masters only says "undergraduate" when nothing else names the level.
  if (ug || (!pg && INTEGRATED.test(name))) levels.push("Undergraduate");
  if (pg) levels.push("Postgraduate");
  if (RESEARCH_NAME.test(name) || RESEARCH_INTL.test(name)) levels.push("Research");
  const fallback = levels.length === 0 ? siteLevel(url) : null;
  if (fallback) levels.push(fallback);
  return levels;
}

type Link = {
  url: string;
  text: string;
  /** For a "Read more" link: the nearest heading before it, likely its card's title. */
  heading?: string;
  /** Which <ul>/<ol> the link sits in directly, by the list's offset in the HTML. */
  list?: number;
};

/** Offsets of every list opening and closing, for placing links in their list. */
function listBounds(html: string) {
  const opens = [...html.matchAll(/<(ul|ol)\b/gi)].map((m) => m.index ?? 0);
  const closes = [...html.matchAll(/<\/(ul|ol)>/gi)].map((m) => m.index ?? 0);
  const lastBefore = (xs: number[], at: number) => {
    let best = -1;
    for (const x of xs) if (x < at) best = x;
    else break;
    return best;
  };
  /** The list an offset sits in, or undefined if a list closed since the last one opened. */
  return (at: number): number | undefined => {
    const open = lastBefore(opens, at);
    return open !== -1 && open > lastBefore(closes, at) ? open : undefined;
  };
}

/** The last heading in the stretch of HTML before an anchor, if there is one close by. */
function headingBefore(html: string, at: number): string | undefined {
  const before = html.slice(Math.max(0, at - 3_000), at);
  const headings = [...before.matchAll(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi)];
  const last = headings.at(-1);
  if (!last) return undefined;
  const text = htmlToText(last[1]).replace(/\s+/g, " ").trim();
  return text && text.length <= 120 ? text : undefined;
}

/** Every same-site link in some HTML, with the text a reader would see on it. */
function links(html: string, base: URL, alias?: Set<string>): Link[] {
  const out: Link[] = [];
  const anchor = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  const listAt = listBounds(html);
  let m: RegExpExecArray | null;

  while ((m = anchor.exec(html)) !== null) {
    const [, attrs, inner] = m;
    const href = attrs.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;

    let target: URL;
    try {
      target = new URL(href.replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(target.protocol)) continue;
    if (!sameSite(target, base) && !alias?.has(siteKey(target.hostname))) continue;
    if (/\.(pdf|docx?|xlsx?|zip|jpe?g|png|gif|mp4|svg)$/i.test(target.pathname)) continue;

    // Course cards wrap a whole card in one link: the title is the first line,
    // the blurb after it is noise.
    let text =
      htmlToText(inner)
        .split("\n")
        .map((l) => l.replace(/^[#•\s]+/, "").trim())
        .find(Boolean) ?? "";
    if (!text) text = htmlToText(attrs.match(/(?:aria-label|title)\s*=\s*["']([^"']+)["']/i)?.[1] ?? "");
    // Icon fonts draw arrows from words: "vertical_split Programas keyboard_arrow_right".
    text = text.replace(/\b[a-z]+(?:_[a-z]+)+\b/g, " ").replace(/\s+/g, " ").trim();
    // BU's program search links every name as "Learn More About Gastronomy (MA)".
    // Only before a degree: "Find out more about undergraduate admissions" is a page, not a course.
    const about = text.replace(/^(learn more|find out more|read more|more) about\s+(?=\S)/i, "");
    if (about !== text && namesDegree(about)) text = about;
    if (!text) continue;
    if (credentialOnly(text)) {
      // The subject is usually written beside the link; failing that, the
      // address names it — Harbour.space's "MEng/MSc/BEng/BSc" goes to /computer-science.
      const fromSlug = nameFromSlug(target.toString());
      const subject = subjectBefore(html, m.index) ?? (fromSlug && !credentialOnly(fromSlug) ? fromSlug : undefined);
      if (subject) text = `${subject} (${text})`;
    }
    const link: Link = { url: normalise(target), text, list: listAt(m.index) };
    if (READ_MORE.test(text)) link.heading = headingBefore(html, m.index);
    out.push(link);
  }
  return out;
}

/** The part of a page that holds its own content, not the site template. */
const contentOf = (html: string) => stripFooter(stripChrome(html));

/**
 * Pick the programme links out of a page's links.
 *
 * Course lists come in runs. A courses-shaped URL with three siblings under
 * the same parent is a list entry; on its own it might be "/courses/fees". A
 * degree in the link text counts too, but also only as part of a run — lone
 * links like "Master's Day" or "How do I apply with an IB Diploma?" are the
 * site talking about degrees, not offering one.
 */
function programmeLinks(all: Link[]): Programme[] {
  // A heading that several "Read more" links share is a section title
  // ("Bachelor's programmes"), not the name of any one of them.
  const headingUses = new Map<string, number>();
  for (const l of all) if (l.heading) headingUses.set(l.heading, (headingUses.get(l.heading) ?? 0) + 1);

  // Short text used for several different links is a label, not a name —
  // Harbour.space links each master's once per campus, as "Barcelona" and
  // "Bangkok". There the address carries the name.
  const textUses = new Map<string, Set<string>>();
  for (const l of all) textUses.set(l.text, (textUses.get(l.text) ?? new Set()).add(l.url));
  const isLabel = (text: string) =>
    text.length <= 30 && (textUses.get(text)?.size ?? 0) >= 3 && !namesDegree(text) && !READ_MORE.test(text);

  const candidates: (Link & { path: string; guessed: boolean })[] = [];
  for (const l of all) {
    const path = new URL(l.url).pathname;
    if (isLabel(l.text) && programmePath(path)) {
      const named = nameFromSlug(l.url);
      if (named && !isGeneric(named)) {
        candidates.push({ url: l.url, text: `${named} (${l.text})`, path, guessed: true });
        continue;
      }
    }
    if (READ_MORE.test(l.text)) {
      if (!programmePath(path)) continue;
      const own = l.heading && headingUses.get(l.heading) === 1 && !isGeneric(l.heading) ? l.heading : null;
      candidates.push({ url: l.url, text: own ?? nameFromSlug(l.url), path, guessed: own === null });
      continue;
    }
    if (l.text.length > 100 || l.text.includes("?") || !/\p{L}/u.test(l.text) || isGeneric(l.text)) continue;
    candidates.push({ ...l, path, guessed: false });
  }

  const pathRuns = new Map<string, Set<string>>();
  const degreeRuns = new Map<string, Set<string>>();
  const tally = (runs: Map<string, Set<string>>, key: string, url: string) => {
    if (!runs.has(key)) runs.set(key, new Set());
    runs.get(key)!.add(url);
  };
  // Only strong paths make a run on their own: "/study/student-life" and
  // "/subjects/biology" sit in long runs too, and neither is a programme.
  for (const c of candidates) {
    if (strongPath(c.path)) tally(pathRuns, parentOf(c.path), c.url);
    if (hasDegree(c)) tally(degreeRuns, parentOf(c.path), c.url);
  }

  const found = new Map<string, Programme>();
  for (const c of candidates) {
    const parent = parentOf(c.path);
    const inPathRun = strongPath(c.path) && (pathRuns.get(parent)?.size ?? 0) >= 4;
    const inDegreeRun = hasDegree(c) && (degreeRuns.get(parent)?.size ?? 0) >= 3;
    if (!inPathRun && !inDegreeRun) continue;

    const prev = found.get(c.url);
    if (!prev || (prev.nameFromUrl && !c.guessed)) {
      // The slug often carries the degree when the visible name doesn't:
      // "Data Engineering" → ".../data-engineering-master-of-science-msc".
      const level = levelOf(`${c.text} ${nameFromSlug(c.url)}`, c.url);
      found.set(c.url, { name: c.text, url: c.url, level, nameFromUrl: c.guessed });
    }
  }

  // A directory that sends every programme to one detail page, told apart only
  // by its query — UW's "prog_detail_find_a_program?progid=…", 533 times. No
  // path run can form there, and plenty of entries name no degree ("Accounting
  // - Milgard School of Business"), but a long run where many do is the list.
  const byDetailPage = new Map<string, typeof candidates>();
  for (const c of candidates) {
    const u = new URL(c.url);
    if (c.guessed || u.search === "") continue;
    const key = `${u.origin}${u.pathname}`;
    byDetailPage.set(key, [...(byDetailPage.get(key) ?? []), c]);
  }
  for (const members of byDetailPage.values()) {
    if (members.length < 10 || members.filter(hasDegree).length / members.length < 0.3) continue;
    for (const c of members) {
      if (found.has(c.url) || credentialOnly(c.text)) continue;
      found.set(c.url, { name: c.text, url: c.url, level: levelOf(c.text, c.url), nameFromUrl: false });
    }
  }

  // A list that's mostly programmes is all programmes. Vienna lists courses
  // with an entrance exam beside the rest, but links them to another
  // subdomain ("aufnahmeverfahren.univie.ac.at/informatik") with nothing in
  // the address to say so. They take their level from their list-mates.
  const byList = new Map<number, typeof candidates>();
  for (const c of candidates) {
    if (c.list === undefined || c.guessed) continue;
    byList.set(c.list, [...(byList.get(c.list) ?? []), c]);
  }
  for (const members of byList.values()) {
    const urls = new Set(members.map((c) => c.url));
    const accepted = [...urls].filter((u) => found.has(u));
    if (accepted.length < 4 || accepted.length / urls.size < 0.6) continue;

    const levels = new Map<string | null, number>();
    for (const u of accepted) {
      const level = found.get(u)!.level;
      levels.set(level, (levels.get(level) ?? 0) + 1);
    }
    const usual = [...levels.entries()].sort((a, b) => b[1] - a[1])[0][0];

    // A filter ("?subject=law") re-lists the page, and a bare "DMA" whose
    // subject couldn't be found names nothing a reader could pick.
    const queriesAreNormal = accepted.some((u) => new URL(u).search !== "");
    for (const c of members) {
      if (found.has(c.url)) continue;
      if ((!queriesAreNormal && new URL(c.url).search !== "") || credentialOnly(c.text)) continue;
      found.set(c.url, { name: c.text, url: c.url, level: levelOf(c.text, c.url) ?? usual, nameFromUrl: false });
    }
  }

  return [...found.values()];
}

/** Link text for a school's graduate division, which may have a site of its own. */
// Only at the start, and "Graduate School" only as the whole link: "About the
// UW Graduate School" is an about page, Berkeley's "American Indian Graduate
// Program" a support programme.
const GRADUATE_SITE =
  /^(the )?graduate (school|division|college)$|^((learn more|find out) about |explore |our )?(the )?graduate (studies|programs|programmes|admissions?)\b|^graduate & professional\b/i;

/**
 * Link text for a programme finder: the list itself, worth opening however
 * many we have. Not "courses": in America those are classes, and BU's "Browse
 * courses" is a catalogue of GMS AN 713 and the like.
 */
const FINDER_TEXT = /\b(find|search|browse|explore) (a |an |our |all )?(program|programme|degree|major)s?\b|\b(program|programme|degree) (finder|search|directory)\b/i;

/** Entries for studying without enrolling on the programme: visiting, non-degree, non-matriculated. */
const NOT_ENROLMENT = /\b(GNM|non[- ]?matriculated|non[- ]?degree|visiting (grad(uate)?|students?|scholars?))\b/i;

/** A–Z lists of everything but courses, which homepages put right beside the course one. */
const NOT_A_HUB =
  /staff|people|services|directory|units|news|events|library|jobs|vacanc|parents|open ?days?|visit|accommodation|clubs|societ|schedule|timetable|single[- ]courses?|masterclass|workshops?/i;

/** A route towards programmes. aculty: a faculty or school page, explored only as a last resort. */
type Hub = { url: string; score: number; faculty?: boolean };
/** A hub this good is worth opening even once we've found plenty. */
const STRONG_HUB = 6;

/**
 * A degree named in the link text or its URL slug. Vienna's links say only
 * "Astronomie"; the degree is in ".../astronomie-bachelorstudium".
 */
function hasDegree(c: { text: string; url: string; guessed: boolean }): boolean {
  return !c.guessed && (namesDegree(c.text) || namesDegree(nameFromSlug(c.url)));
}

/** Links worth following to reach the course list, best first. */
function hubLinks(all: Link[], seen: Set<string>, home: string): Hub[] {
  const scores = new Map<string, number>();
  const faculties = new Set<string>();
  for (const l of all) {
    // The graduate school's link matters only where it leads off the site — to
    // grad.uw.edu from washington.edu. On the site, the level's own links get there.
    const sisterSite = GRADUATE_SITE.test(l.text) && siteKey(new URL(l.url).hostname) !== home;
    // The address counts as well as the words: "Barcelona Courses" goes to /schedule/…
    if (seen.has(l.url) || l.text.length > 60 || !(isHubText(l.text) || FINDER_TEXT.test(l.text) || sisterSite)) continue;
    if (NOT_A_HUB.test(l.text) || NOT_A_HUB.test(new URL(l.url).pathname)) continue;
    let score = 1;
    // Sites write "A–Z" with every dash there is, non-breaking hyphens included.
    if (/\ba ?(to|[-‐‑–—]) ?z\b|all (courses|programmes|programs|degrees)|course (finder|search|list)/i.test(l.text)) score += 3;
    if (/\b(courses|programmes|programs|degrees)\b|studienangebot|studieng(ä|ae)nge/i.test(l.text) || HUB_INTL.test(l.text)) score += 2;
    // A level's landing page is often the only way to that level's list —
    // worth opening even after another level has turned up plenty.
    if (/^(undergraduate|postgraduate|graduate|taught|master'?s|masters|doctoral|phd|research degrees?)\b/i.test(l.text) || LEVEL_HUB_INTL.test(l.text)) {
      score += STRONG_HUB;
    } else if (sisterSite || FINDER_TEXT.test(l.text)) {
      // "Learn more about graduate programs", "Find a Program": the way to a
      // level's list, or the list itself.
      score += STRONG_HUB;
    }
    // Short, open and summer courses aren't degrees; they mustn't crowd out the
    // routes to them. Online *degrees* are degrees, so "online" alone isn't penalised.
    if (/\b(short|open|summer|continuing|cpd|mooc)\b/i.test(`${l.text} ${l.url}`)) score -= 3;
    if (segments(new URL(l.url).pathname).some((s) => STRONG_SEGMENT.test(s))) score += 1;
    if (score > (scores.get(l.url) ?? -Infinity)) scores.set(l.url, score);
    if (FACULTY_TEXT.test(l.text) && !HUB_TEXT.test(l.text) && !HUB_INTL.test(l.text)) faculties.add(l.url);
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([url, score]) => ({ url, score, faculty: faculties.has(url) }));
}

/** Other pages of the same list: same path, a page number or "next". */
function pagerLinks(all: Link[], at: URL, seen: Set<string>): string[] {
  const here = at.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "");
  return [
    ...new Set(
      all
        .filter((l) => {
          if (seen.has(l.url) || !PAGER_TEXT.test(l.text)) return false;
          const u = new URL(l.url);
          const path = u.pathname.replace(/\/page\/\d+\/?$/, "").replace(/\/$/, "");
          return path === here && (u.search !== at.search || u.pathname !== at.pathname);
        })
        .map((l) => l.url),
    ),
  ];
}

const ABBREVIATIONS: Record<string, string> = {
  ba: "BA", bsc: "BSc", beng: "BEng", bmus: "BMus", bed: "BEd", bba: "BBA", bfa: "BFA", llb: "LLB",
  meng: "MEng", msci: "MSci", msc: "MSc", ma: "MA", mba: "MBA", mfa: "MFA", mphil: "MPhil", mres: "MRes",
  mph: "MPH", llm: "LLM", pgce: "PGCE", pgdip: "PGDip", pgcert: "PGCert", phd: "PhD", dphil: "DPhil",
  mmath: "MMath", mphys: "MPhys", mchem: "MChem", hons: "(Hons)", ai: "AI",
  pg: "PG", cert: "Cert", dip: "Dip", dba: "DBA", edd: "EdD", msw: "MSW", mpa: "MPA", mpp: "MPP",
  and: "and", of: "of", in: "in", with: "with", the: "the", for: "for", to: "to", at: "at",
};

/** "189-computer-science-bsc-hons" → "Computer Science BSc (Hons)". */
function nameFromSlug(url: string): string {
  const last = segments(new URL(url).pathname).pop() ?? "";
  return last
    .replace(/\.(html?|aspx?|php)$/, "")
    .split(/[-_+]+/)
    .filter((w) => w && !/^\d+$/.test(w))
    .map((w, i) => {
      const known = ABBREVIATIONS[w];
      // Small words stay lower case, except where they open the name.
      if (known && !(i === 0 && known === w)) return known;
      return w[0].toUpperCase() + w.slice(1);
    })
    .join(" ");
}

function locs(xml: string): string[] {
  return [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
}

function yearOf(url: string): number | null {
  const years = [...new URL(url).pathname.matchAll(/(?:^|[/-])(20\d{2})(?=[/-]|$)/g)].map((m) => Number(m[1]));
  return years.length > 0 ? Math.max(...years) : null;
}

/**
 * Programme pages listed in the site's sitemap. The fallback for course
 * finders that build their list in the browser: the HTML has no links, but the
 * sitemap still lists every course page so search engines can find them.
 */
async function sitemapProgrammes(
  base: URL,
  /** Course-list pages visited on the way, whose sections the programmes probably live in. */
  hubs: URL[],
  onProgress?: (m: string) => void,
): Promise<{ found: Programme[]; read: string[] }> {
  const origin = base.origin;
  let roots: string[] = [];
  try {
    const robots = await getHtml(`${origin}/robots.txt`);
    roots = [...robots.matchAll(/^\s*sitemap:\s*(\S+)/gim)].map((m) => m[1]);
  } catch {
    // No robots.txt — the conventional location below is worth a try anyway.
  }
  if (roots.length === 0) roots = [`${origin}/sitemap.xml`];

  // Big sites run one sitemap per section, and the index lists hundreds of
  // them — McGill's has 714, and its graduate programmes are all in
  // /gradapplicants/sitemap.xml. The section the user pasted comes first, then
  // the sections of the course lists we stepped into: from McGill's homepage,
  // "Find a graduate program" leads to /gradapplicants/programs, whose list
  // is built in the browser, but whose section sitemap names every programme.
  const sectionRoots = [base, ...hubs]
    .filter((u) => sameSite(u, base) && segments(u.pathname).length > 0)
    .map((u) => `${u.origin}/${segments(u.pathname)[0]}`);
  const sections = [...new Set(sectionRoots)].slice(0, MAX_SECTIONS);
  roots = [...sections.map((s) => `${s}/sitemap.xml`), ...roots];

  onProgress?.("Checking the site map");
  const read: string[] = [];
  const pageUrls: string[] = [];

  const tried = new Set<string>();
  const fetchXml = async (url: string) => {
    // A section sitemap we asked for directly turns up again in the index.
    if (tried.has(url)) return null;
    tried.add(url);
    try {
      const xml = await getHtml(url, { allowXml: true, maxBytes: SITEMAP_BYTES });
      read.push(url);
      return xml;
    } catch {
      return null;
    }
  };

  for (const root of [...new Set(roots)].slice(0, sections.length + 2)) {
    const xml = await fetchXml(root);
    if (!xml) continue;
    if (!/<sitemapindex/i.test(xml)) {
      pageUrls.push(...locs(xml));
      continue;
    }
    // An index of sitemaps: the ones named for courses, or failing that the
    // first few, since some sites split by number rather than by section.
    const children = locs(xml).filter((u) => !/\.gz$/i.test(u) && !tried.has(u));
    const inSection = children.filter((u) => sections.some((s) => u.startsWith(`${s}/`)));
    const named = children.filter((u) => /course|programme|program|degree|study|studien|undergrad|postgrad/i.test(u));
    const chosen = [...new Set([...inSection, ...named])].slice(0, 4);
    if (chosen.length === 0) chosen.push(...children.slice(0, 4));
    const docs = await Promise.all(chosen.map(fetchXml));
    for (const doc of docs) if (doc) pageUrls.push(...locs(doc));
  }

  let candidates: string[] = [];
  for (const raw of pageUrls) {
    try {
      const url = new URL(raw);
      if (sameSite(url, base) && programmePath(url.pathname, true)) candidates.push(normalise(url));
    } catch {
      // A malformed <loc> — skip it.
    }
  }
  candidates = [...new Set(candidates)];

  // Bilingual sites list every page twice — McGill has "/fr/programme/social-
  // work" beside "/program/social-work". Where the site has pages outside a
  // language folder, those are the originals; a site that's all in language
  // folders keeps them all.
  const translated = (u: string) => segments(new URL(u).pathname).some((s) => LANGUAGE_SEGMENT.test(s));
  if (candidates.some((u) => !translated(u))) candidates = candidates.filter((u) => !translated(u));

  // Sites keep every past year's prospectus: "/undergraduate-2020/politics"
  // beside "/undergraduate-2027/politics". Keep the newest of each, and drop
  // years older than the newest the site lists — those are archive pages.
  const newest = Math.max(0, ...candidates.map((u) => yearOf(u) ?? 0));
  const byCourse = new Map<string, string>();
  for (const u of candidates) {
    const year = yearOf(u);
    if (year !== null && year < newest - 1) continue;
    const key = u.replace(/([/-])20\d{2}(?=[/-]|$)/g, "$1");
    const prev = byCourse.get(key);
    if (!prev || (yearOf(u) ?? 0) > (yearOf(prev) ?? 0)) byCourse.set(key, u);
  }
  const current = new Set(byCourse.values());

  // A programme's own sub-pages ("/courses/law/modules") share its prefix;
  // keep the programme, drop the pages beneath it.
  const kept = [...current].filter((u) => !current.has(u.replace(/\/[^/]+$/, "")));

  // Only trust parents with a run of siblings — a lone "/courses/why-us"
  // isn't a course list, forty pages under "/courses/" are.
  const byParent = new Map<string, string[]>();
  for (const u of kept) {
    const parent = u.replace(/\/[^/]+$/, "");
    byParent.set(parent, [...(byParent.get(parent) ?? []), u]);
  }
  const found = [...byParent.values()]
    .filter((group) => group.length >= 5)
    .flat()
    .map((url) => {
      const name = nameFromSlug(url);
      return { name, url, level: levelOf(name, url), nameFromUrl: true };
    });

  return { found, read };
}

function siteName(html: string): string | null {
  const site = html.match(/<meta[^>]+property\s*=\s*["']og:site_name["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1];
  return site ? htmlToText(site) : null;
}

/** The part of a site a page belongs to: "https://www.mcgill.ca/gradapplicants". */
function sectionOf(url: URL): string {
  return `${url.origin}/${segments(url.pathname)[0] ?? ""}`;
}

/**
 * Who a page says its part of the site is for. Admissions sites name their
 * audience in every page's site name or title — "UBC | Undergraduate Programs
 * and Admissions", "Future Graduate Students" — even where the programme
 * addresses ("/programs/commerce") say nothing about level.
 */
function audienceOf(html: string): string | null {
  const name = siteName(html) ?? pageTitle(html) ?? "";
  const undergraduate = /\bundergrad/i.test(name);
  const graduate = /\b(post)?grad(uate)?\b/i.test(name);
  if (undergraduate === graduate) return null; // neither, or a site for both
  return undergraduate ? "Undergraduate" : "Postgraduate";
}

function schoolName(html: string): string | null {
  const site = siteName(html);
  if (site) return site;
  const title = pageTitle(html);
  if (!title) return null;
  // "Courses | University of Somewhere" — the school is usually the last part.
  const parts = title.split(/\s+[|–—-]\s+/).map((p) => p.trim()).filter(Boolean);
  return parts.find((p) => /universit|college|school|institut|academy|polytechnic|hochschule/i.test(p)) ?? parts.at(-1) ?? null;
}

/**
 * The programmes reachable from a link. `onProgress` reports each step so the
 * UI isn't silent through what can be a couple of dozen fetches.
 */
export async function findProgrammes(startUrl: string, onProgress?: (message: string) => void): Promise<ProgrammeList> {
  const base = validateUrl(startUrl);
  onProgress?.(`Reading ${base.hostname}`);

  // The English version where there is one, so programme names come out in
  // English and every hub and list below is followed in English too.
  const root = await fetchPreferEnglish(base.toString(), {}, onProgress);
  const school = schoolName(root.html);

  // A homepage whose links mostly go to one other domain is that school under
  // another name — Universidad de Sonora answers at uson.mx but links
  // everywhere to unison.mx. Treat that domain as the same site.
  const alias = new Set<string>();
  {
    const home = siteKey(new URL(root.url).hostname);
    const counts = new Map<string, number>();
    let total = 0;
    for (const m of root.html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["']/gi)) {
      try {
        const key = siteKey(new URL(m[1].replace(/&amp;/g, "&"), root.url).hostname);
        total++;
        if (key !== home) counts.set(key, (counts.get(key) ?? 0) + 1);
      } catch {
        // mailto:, javascript: and the like
      }
    }
    const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
    if (n >= 10 && n / Math.max(total, 1) >= 0.4) alias.add(top);
  }

  const programmes = new Map<string, Programme>();
  const add = (list: Programme[]) => {
    for (const p of list) {
      const prev = programmes.get(p.url);
      if (!prev || (prev.nameFromUrl && !p.nameFromUrl)) programmes.set(p.url, p);
    }
  };

  const seen = new Set<string>([normalise(base), normalise(new URL(root.url))]);
  const pagesSearched = [root.url];
  let fetches = 1;

  /** Fetch pages we haven't seen, within budget; failures just drop out. */
  async function fetchAll(urls: string[]) {
    const batch = urls.filter((u) => !seen.has(u)).slice(0, Math.max(0, FETCH_BUDGET - fetches));
    batch.forEach((u) => seen.add(u));
    fetches += batch.length;
    // One more try for a page that timed out or dropped the connection: slow
    // university servers are common, and losing a course list to one slow
    // response loses every programme on it. Refusals and 404s aren't retried.
    const fetchTwice = (u: string) =>
      fetchPreferEnglish(u).catch((err: unknown) => {
        const transient = err instanceof Error && /too long to respond|couldn't reach/i.test(err.message);
        if (!transient) throw err;
        return fetchPreferEnglish(u);
      });
    const results = await Promise.allSettled(batch.map(fetchTwice));
    const pages = results.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
    // A page that switched to English shouldn't be fetched again by that address.
    for (const p of pages) seen.add(normalise(new URL(p.url)));
    return pages;
  }

  /** Each section's audience, as its pages state it; null where its pages disagree. */
  const audiences = new Map<string, string | null>();
  function noteAudience(page: { html: string; url: string }) {
    const audience = audienceOf(page.html);
    if (!audience) return;
    const key = sectionOf(new URL(page.url));
    const prev = audiences.get(key);
    audiences.set(key, prev === undefined || prev === audience ? audience : null);
  }

  let renders = 0;

  /**
   * A school's graduate site often lives under another domain — washington.edu
   * sends "Graduate School" to grad.uw.edu. A link that says it goes to the
   * graduate school, or lands on a grad. host, makes that domain the school's too.
   */
  function adoptSisterSites(html: string, at: URL) {
    for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const href = m[1].match(/href\s*=\s*["']([^"'#][^"']*)["']/i)?.[1];
      if (!href) continue;
      let target: URL;
      try {
        target = new URL(href.replace(/&amp;/g, "&"), at);
      } catch {
        continue;
      }
      const key = siteKey(target.hostname);
      if (!/^https?:$/.test(target.protocol) || sameSite(target, at) || alias.has(key)) continue;
      const text = htmlToText(m[2]).replace(/\s+/g, " ").trim();
      if (GRADUATE_SITE.test(text) || GRAD_HOST.test(target.hostname)) alias.add(key);
    }
  }

  /** Harvest a page; walk its pagination if it turned out to be a list. Returns hub links found. */
  async function harvest(page: { html: string; url: string }): Promise<Hub[]> {
    let at = new URL(page.url);
    adoptSisterSites(page.html, at);
    let found = programmeLinks(links(contentOf(page.html), at, alias));
    // A course finder that builds its list in the browser: nothing in the
    // HTML, everything once its scripts have run. Rendered, it's read like
    // any other page — links, hubs and all.
    if (found.length === 0 && renders < RENDER_BUDGET && looksScripted(page.html)) {
      renders++;
      onProgress?.("Opening a course finder that needs a browser");
      const rendered = await renderPage(page.url);
      if (rendered) {
        page = rendered;
        at = new URL(page.url);
        found = programmeLinks(links(contentOf(page.html), at, alias));
      }
    }
    noteAudience(page);
    add(found);
    const hubs = hubLinks(links(page.html, at, alias), seen, siteKey(new URL(root.url).hostname));

    if (found.length > 0) {
      let pagers = pagerLinks(links(page.html, at, alias), at, seen);
      while (pagers.length > 0 && fetches < FETCH_BUDGET) {
        onProgress?.(`Reading more of the list (${programmes.size} so far)`);
        const pages = await fetchAll(pagers.slice(0, 6));
        if (pages.length === 0) break;
        const before = programmes.size;
        const next: string[] = [];
        for (const p of pages) {
          const pAt = new URL(p.url);
          pagesSearched.push(p.url);
          add(programmeLinks(links(contentOf(p.html), pAt, alias)));
          next.push(...pagerLinks(links(p.html, pAt, alias), pAt, seen));
        }
        // Pages that add nothing new are a list we already have, filtered
        // another way — stop rather than spend the budget on it.
        if (programmes.size === before) break;
        pagers = [...new Set([...pagers.slice(6), ...next])].filter((u) => !seen.has(u));
      }
    }
    return hubs;
  }

  // Menus are where homepages keep "Courses" — so hubs are looked for in the
  // whole page, while programmes come from the content alone.
  let frontier = await harvest(root);

  // A course page sits at a programme-shaped address and isn't itself a list —
  // or turns up in the school's own list once we've found it.
  const rootKey = normalise(new URL(root.url));
  // What the pasted page listed by itself. Four or more, and it's a list — even
  // if it links to itself, as /masters does from its own menu.
  const rootListed = programmes.size;
  const looksLikeCourse = strongPath(new URL(root.url).pathname) && rootListed < 4;

  // Once there's plenty, only a clearly-labelled course list is worth the
  // fetch — "Undergraduate degree programmes A–Z" after the subject pages, say.
  // Faculty pages are a last resort — but once one has turned out to list
  // programmes, the rest of the faculties are the rest of the list, so they're
  // all worth a visit (budget allowing), however many we already have.
  let facultiesPay = false;
  for (let step = 0; step < HUB_STEPS + (facultiesPay ? 3 : 0) && fetches < FETCH_BUDGET; step++) {
    const worth = frontier.filter(
      (h) => !seen.has(h.url) && (programmes.size < ENOUGH || h.score >= STRONG_HUB || (facultiesPay && h.faculty)),
    );
    if (worth.length === 0) break;
    const onlyFaculties = worth.every((h) => h.faculty);
    const chosen = worth.slice(0, onlyFaculties ? HUBS_PER_STEP + 2 : HUBS_PER_STEP);
    const batch = chosen.map((h) => h.url);
    const facultyUrls = new Set(chosen.filter((h) => h.faculty).map((h) => h.url));
    onProgress?.(`Looking through ${batch.length} course page${batch.length > 1 ? "s" : ""}`);

    const next = new Map<string, Hub>();
    for (const page of await fetchAll(batch)) {
      pagesSearched.push(page.url);
      const before = programmes.size;
      for (const h of await harvest(page)) {
        const prev = next.get(h.url);
        if (!prev || h.score > prev.score) next.set(h.url, h);
      }
      if (programmes.size > before && [...facultyUrls].some((u) => normalise(new URL(u)) === normalise(new URL(page.url)) || page.url.startsWith(u))) {
        facultiesPay = true;
      }
    }
    // Unvisited hubs from earlier steps stay in the running.
    for (const h of frontier) if (!next.has(h.url)) next.set(h.url, h);
    frontier = [...next.values()].sort((a, b) => b.score - a.score);
  }

  // A school's full list runs to hundreds. Finding fewer usually means we saw
  // one corner of it — Bath's HTML has the undergraduate subjects, and only
  // the sitemap has its master's and doctorates.
  if (programmes.size < SITEMAP_BELOW) {
    // Pages at a courses-shaped address ("/gradapplicants/programs") are the
    // lists themselves; the rest of what we visited only led there.
    const visited = pagesSearched.slice(1).map((u) => new URL(u));
    const lists = visited.filter((u) => segments(u.pathname).some((s) => STRONG_SEGMENT.test(s)));
    const { found, read } = await sitemapProgrammes(new URL(root.url), lists.length > 0 ? lists : visited, onProgress);
    pagesSearched.push(...read);
    // The sitemap lists every page under a courses-shaped path, modules and
    // past sittings included. If the pages themselves already named real
    // degrees, trust only sitemap entries that do too — Harbour.space's
    // sitemap holds ~900 module runs beside its ten degrees.
    const named = (p: Programme) => namesDegree(p.name) || namesDegree(nameFromSlug(p.url));
    // "Real" means it names a degree or sits where the site files a level.
    const pagesHadDegrees = [...programmes.values()].filter((p) => named(p) || p.level !== null).length >= 3;
    // Then a trailing ID number marks one sitting of something ("…-solomatin-1549"), not a programme.
    const sitting = (p: Programme) => /[-_]\d{3,}\/?$/.test(new URL(p.url).pathname);
    // …and it has to sit in a part of the site the real ones came from: the
    // sitemap filling in a list we've seen, not wandering into the modules.
    const top = (url: string) => `${new URL(url).hostname}/${segments(new URL(url).pathname)[0] ?? ""}`;
    const seenTops = new Set([...programmes.values()].map((p) => top(p.url)));
    add(pagesHadDegrees ? found.filter((p) => named(p) && !sitting(p) && seenTops.has(top(p.url))) : found);
  }

  if (programmes.size === 0 && htmlToText(root.html).length < 2_500) {
    throw new ScrapeError(
      "Couldn't find any programmes there — the page probably builds its course list with JavaScript, and the site map didn't list them either. Try the link of a single course instead.",
    );
  }

  // A programme whose name and address don't give its level takes its
  // section's audience, or failing that the whole site's: Commerce at
  // you.ubc.ca/programs/commerce is undergraduate because the site says it is.
  for (const p of programmes.values()) {
    if (p.level) continue;
    const url = new URL(p.url);
    const section = sectionOf(url);
    p.level = (audiences.has(section) ? audiences.get(section) : audiences.get(`${url.origin}/`)) ?? null;
  }

  // A degree programme's own modules aren't programmes: Harbour.space's
  // /computer-science/courses/advanced-algorithms is a class in its Computer
  // Science degree at /computer-science. "Degree programme" means one that
  // names a degree, so a plain department page can't swallow what's under it.
  const all = [...programmes.values()];
  const degreeIn = (p: Programme) => namesDegree(p.name) || namesDegree(nameFromSlug(p.url));
  const degreePaths = all.filter(degreeIn).map((p) => {
    const u = new URL(p.url);
    return `${u.hostname}${u.pathname.replace(/\/$/, "")}/`;
  });
  const standalone = all.filter((p) => {
    const u = new URL(p.url);
    const here = `${u.hostname}${u.pathname}`;
    const parent = degreePaths.find((path) => here.startsWith(path));
    if (!parent) return true;
    // Only what's in the programme's own courses/modules folder is a module —
    // whatever its name says ("Masters Machine Learning" is a class). Other
    // pages beneath it stay: BU files real minors and certificates under a
    // department's degree page.
    const below = here.slice(parent.length).split("/").filter(Boolean).map((s) => s.toLowerCase());
    return !below.some((s) => /^(courses?|modules?|units?|classes|lectures?)$/.test(s));
  });

  // The same course listed once per run — each sitting with its own page that
  // differs only by a trailing number ("…-masterclass-1584", "…-1680"). Same
  // name and same address bar that number: one course; keep the first. The
  // address has to match too, or BU's three different "Two-Year LLM"s merge.
  const seenCourse = new Set<string>();
  const seenName = new Set<string>();
  const unique = standalone.filter((p) => {
    const u = new URL(p.url);
    const plain = p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    // A name read off an address that's a single short word is an acronym
    // nobody can pick from: Prešov's "/phd/cavv" → "Cavv".
    if (p.nameFromUrl && !plain.includes(" ") && plain.length <= 5) return false;
    // Ways to take classes without being on the degree — UW lists a "- GNM"
    // (graduate non-matriculated) and a "Visiting Grad" beside most programmes.
    if (NOT_ENROLMENT.test(p.name)) return false;
    const stem = u.pathname.replace(/\/$/, "").replace(/[-_]?\d+$/, "");
    const key = `${u.hostname}${stem}|${plain}`;
    if (seenCourse.has(key)) return false;
    seenCourse.add(key);
    // The same programme filed at two addresses — Jefferson State has
    // /programs/banking-finance and /academics/programs/banking-finance.
    // Only for names long enough to be specific (short ones like BU's
    // "Two-Year LLM" can name different programmes), and only at the same
    // level — TUM's bachelor's and master's in Mechanical Engineering share a name.
    // And the addresses must end alike (both …/banking-finance): Leoben labels
    // several different masters "Master - Materials", each at its own address.
    if (plain.length >= 15) {
      const tail = segments(u.pathname).at(-1)?.replace(/\.(html?|aspx?|php)$/, "") ?? "";
      const byName = `${siteKey(u.hostname)}|${levelOf(`${p.name} ${nameFromSlug(p.url)}`, p.url) ?? "-"}|${plain}|${tail}`;
      if (seenName.has(byName)) return false;
      seenName.add(byName);
    }
    return true;
  });

  const list = unique
    .map((p) => {
      // Several levels only when the name lists credentials from several;
      // otherwise the one already worked out, which may have come from a list-mate.
      const spans = levelsOf(`${p.name} ${nameFromSlug(p.url)}`, p.url);
      return { ...p, levels: spans.length > 1 ? spans : p.level ? [p.level] : [] };
    })
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
    .slice(0, MAX_RESULTS);

  const startIsProgramme =
    looksLikeCourse || (rootListed < 4 && (programmes.has(rootKey) || programmes.has(normalise(base))));
  // A list page that links to itself shouldn't appear in its own list.
  if (rootListed >= 4) {
    const self = list.findIndex((p) => p.url === rootKey || p.url === normalise(base));
    if (self !== -1) list.splice(self, 1);
  }
  return { school, programmes: list, pagesSearched, startIsProgramme };
}
