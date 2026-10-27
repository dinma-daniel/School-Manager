# School Planner

Paste a university or school link. Get back the application — how to apply, the
deadlines, the entry requirements, the costs and the scholarships — laid out in
one place, in plain language, without the important details quietly dropped.

## Running it

```bash
cp .env.local.example .env.local
npm run dev
```

Then open http://localhost:3000.

**You can look around with no model and no key at all** — the empty state has a
_load two samples_ button that fills the planner with example data so you can
see every screen. Samples are badged `SAMPLE`, because their figures are
illustrative rather than read from those universities' sites.

To actually read a link, pick a backend below.

## Choosing a backend

Set `EXTRACTOR` in `.env.local`. The default is `ollama`, so a fresh clone costs
nothing and needs no account.

| `EXTRACTOR`          | What it is                                                                            | Cost                    | Trade-off                                                 |
| -------------------- | ------------------------------------------------------------------------------------- | ----------------------- | --------------------------------------------------------- |
| `ollama` _(default)_ | A model on your own machine                                                           | Free                    | Needs ~8GB RAM free, slower, less accurate on messy pages |
| `openai`             | Any OpenAI-compatible endpoint — Hugging Face, Groq, OpenRouter, LM Studio, llama.cpp | Free tiers available    | Rate limits; free tiers can change                        |
| `claude`             | Claude via the Anthropic API                                                          | ~2p per school on Haiku | Costs money, most accurate                                |

They all share one prompt and one schema ([`lib/extract/prompt.ts`](lib/extract/prompt.ts),
[`lib/schema.ts`](lib/schema.ts)), so switching changes cost and quality, never
behaviour.

### Ollama

```bash
ollama pull qwen3:8b     # then set OLLAMA_MODEL to match
```

**Ollama caps every model at a 4096-token context by default** and silently
drops whatever doesn't fit — which here is the half of the page with the
deadlines in it. `OLLAMA_NUM_CTX` (default 32768) overrides that, and the
scraper sizes what it collects to fit whatever you set.

### OpenAI-compatible (Groq — tested, free)

```
EXTRACTOR=openai
EXTRACTOR_BASE_URL=https://api.groq.com/openai/v1
EXTRACTOR_MODEL=openai/gpt-oss-120b
EXTRACTOR_API_KEY=gsk_...
EXTRACTOR_MAX_CHARS=16000
EXTRACTOR_MAX_PAGES=2
```

These exact settings were run against live university sites and work.

**The binding limit on a free tier is tokens per minute, not context window.**
Groq's free tier allows 8,000 TPM while the model itself has a 131k context, so
roughly one school per minute, and about 16k characters of page text per
request. Going much higher returns `413`. Two things follow:

- `groq/compound` advertises 70k TPM but routes to `gpt-oss-120b` underneath, so
  the 8k limit applies anyway — and it doesn't support `json_schema`.
- Because the budget is small, the scraper keeps the _relevant_ sections of a
  page rather than the first N characters (see `condense()` in
  [`lib/scrape.ts`](lib/scrape.ts)). On the same 16k budget that changed a
  Sheffield extraction from 0 steps and 0 scholarships to 6 steps, 2
  scholarships and real grade requirements.

Other endpoints work the same way — Hugging Face
(`https://router.huggingface.co/v1`), OpenRouter, LM Studio. If a model doesn't
support `json_schema`, the backend notices once and falls back to prompting.

## How it works

0. **Find programmes** — [`lib/programmes.ts`](lib/programmes.ts) turns a school
   link into a list of its programmes to pick from, with no model involved.
   Programme links give themselves away: long runs of sibling links under a
   courses-shaped path, usually with a degree in the text. It reads the pasted
   page, steps into course-list pages it links to ("Degree programmes A–Z"),
   walks paginated lists, and falls back to the sitemap when the HTML is thin.
   A course finder that builds its list with JavaScript (UW's graduate
   directory, BU's program search) is opened in a headless browser instead —
   see [`lib/render.ts`](lib/render.ts). Each picked programme then goes through the steps below as its own entry,
   one at a time so free tiers and local models aren't swamped. A single course
   link is recognised as one and offered for reading straight away.

1. **Fetch** — [`lib/scrape.ts`](lib/scrape.ts) loads the page, strips site
   chrome, and follows same-site links whose anchor text looks like application
   information. It prefers links in the page's own content over global-menu
   links, and links that stay in the same branch of the site — so an
   undergraduate course page follows undergraduate fees, not postgraduate. It
   collects only as much text as the chosen backend can handle.

2. **Extract** — [`app/api/extract/route.ts`](app/api/extract/route.ts) hands the
   text to the configured backend and streams progress back over SSE, because a
   local model can take minutes and silence feels broken.

3. **Repair** — [`lib/extract/parse.ts`](lib/extract/parse.ts) copes with what
   small models actually return: markdown fences, a sentence of preamble,
   missing fields, `"N/A"` where the schema wants `null`. A good answer isn't
   thrown away over any of those.

4. **Keep** — saved in `localStorage` ([`lib/storage.ts`](lib/storage.ts)). No
   database, no account, nothing sent anywhere but the page fetch and the model.

## The two rules the extraction follows

- **Never invent.** Every date, grade, fee and scholarship has to appear in the
  fetched pages. Anything missing becomes `null` and is named under
  **Still to check yourself**, so a gap stays visible instead of being filled in.
- **Never drop something because it's fiddly.** The language gets simpler; the
  content does not. Anything that quietly costs people their place is surfaced
  under **Easy to miss**.

## Known limits

- **Smaller models are meaningfully worse at this.** The pages are long and
  badly structured, which is the hardest case for a small local model. If a
  brief looks thin, check it against the real page before trusting it.
- **JavaScript-rendered pages** (course finders, applicant portals) return an
  empty shell to a plain fetch. These are detected and refused with an
  explanation rather than guessed at.
- **Some sites refuse non-browser traffic.** We identify ourselves honestly
  rather than impersonating Chrome — several university WAFs (DAAD among them)
  return `403` specifically to Chrome user-agents that don't complete a browser
  handshake, while allowing plain agents through. If a site still refuses, the
  fetcher retries once as Firefox, then loads the page in the headless browser
  (utoronto.ca only lets that in). A site that challenges the browser too —
  Cloudflare's "Just a moment…", as at umich.edu — stays refused; the app
  doesn't try to get past bot checks.
- **Aggregator sites only get you so far.** On a directory like DAAD, the real
  application detail lives on the university's own site, and those links are
  off-host so they aren't followed. Expect a thinner brief; paste the
  university's own page for the full picture.
- **Dates without a year don't get countdowns.** Some sites write "October 15"
  with no year. That's kept and displayed, but left off the calendar rather
  than guessed at, so those entries don't sort by urgency.
- **Programme lists built entirely in the browser** (search-only course
  finders) have no links in their HTML. When a page looks like an app shell,
  the finder opens it in a headless browser — Chrome or Edge, whichever is
  installed, or the one `BROWSER_PATH` points at — up to three times a search.
  With no browser available it falls back to the sitemap, with names read off
  the URL and marked `~`; if a site has neither, paste a course link directly.
  Up to 20 programmes can be read in one go.
- **PDFs aren't read**, and some schools put entry requirements in one.
- **Pages behind a login** can't be reached.
- Saved schools live in one browser and won't follow you to another device.

Always check a deadline against the school's own page before relying on it.

## Layout

```
app/
  api/extract/route.ts     fetch + extract, streamed over SSE
  api/programmes/route.ts  find a school's programmes, streamed over SSE
components/                Planner, AddSchool, ProgrammePicker, SchoolEntry, Compare, ThemeToggle
lib/
  schema.ts                the extraction schema — the shape of the whole app
  scrape.ts                fetching, link ranking, HTML to text
  programmes.ts            programme discovery: course lists, pagination, sitemaps
  render.ts                headless-browser fallback for JavaScript-built course lists
  events.ts                the SSE framing both routes and the client share
  extract/
    index.ts               picks the backend from EXTRACTOR
    prompt.ts              the shared prompt
    parse.ts               repairs and normalises model output
    ollama.ts              local models
    openai-compatible.ts   Hugging Face, Groq, OpenRouter, LM Studio, ...
    claude.ts              Anthropic API
  demo.ts                  sample schools, so it runs with no model at all
  dates.ts                 deadline sorting and countdowns
  storage.ts               the saved list
```
