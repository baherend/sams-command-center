# Murshid (مُرشِد) — CRDC research assistant

**Murshid** («مُرشِد», *the one who guides*) answers researchers from the center's procedural guide (الدليل الإجرائي) and nothing else. Under every answer the widget draws a short chain from the answer to its source; when the guide has no answer, the chain is shown broken.

A retrieval-augmented assistant that answers researchers' questions about the **Consulting, Research
and Development Center (CRDC)** at Sadat Academy: the five services, fees, procedures, publishing
rules, formatting, and degree requirements. It answers **only from the center's procedural guide** and
includes an exact fee calculator.

It answers in Arabic (including Egyptian colloquial) and in English. It needs no paid API and no GPU.

---

## 1. How it stops hallucination

Most "RAG chatbots" retrieve text and then let an LLM write the answer. That generation step is
where hallucination happens. **This system has no generation step.**

| Question type | Who answers | Can it invent? |
|---|---|---|
| Procedures, rules, formatting, requirements | The matched chunk of the guide, **shown word for word** | No |
| Page-based fees ("نشر بحث 32 صفحة كام؟") | A calculator reading `knowledge/fees.json` | No (plain arithmetic) |
| "Which journal should I publish in?" | Specialization buttons, then a lookup in `knowledge/journals.json` | No (fixed map) |
| Anything the guide doesn't cover | A fixed refusal message plus the center's email | No |

The worst failure mode is therefore **showing the wrong (but real) section of the guide**, never an
invented fact. To make that visible, every answer is labelled with the section it came from.

## 2. Architecture

```
question
  │
  ├─ guard: empty / too long ───────────────────────────────► message
  ├─ small talk (greeting / thanks) ────────────────────────► fixed reply
  ├─ calculator (fee intent + service + page count) ───────► computed from fees.json
  └─ retrieval
       ├─ dense:   multilingual-e5-small (ONNX, local) → FAISS inner-product search
       ├─ keyword: BM25 with Arabic normalization
       ├─ fusion:  Reciprocal Rank Fusion
       └─ gate:    answer only if the best chunk clearly stands out (see §4),
                   and refuse if an out-of-scope guard topic wins
                     ├─ pass → the chunk text, verbatim, plus source and related topics
                     └─ fail → refusal
```

| Folder | What's inside |
|---|---|
| `knowledge/guide_ar.md`, `guide_en.md` | The guide, one `## [id] Title` section per chunk; same ids in both languages |
| `knowledge/fees.json` | **Single source of truth for every fee** (fee chunks and the calculator are both generated from it) |
| `knowledge/out_of_scope.md` | Guard topics that are indexed but never shown (phone numbers, tuition, admission…) |
| `knowledge/journals.json` | The two journals (verified facts) + specialization → journal map (**proposed**, awaiting editorial approval) |
| `rag/` | Engine: `text` (normalization, linkify), `chunker`, `fees`, `embedder`, `bm25`, `index`, `engine` |
| `app/` | FastAPI server plus the Murshid chat widget (`app/static/index.html`); fonts are self-hosted in `app/static/fonts/` (Readex Pro, SIL OFL), so the page makes no request to Google |
| `eval/` | Tuning set (54 in-scope, 18 out-of-scope, 7 calculator) and hold-out set (30 / 12 / 3) |
| `scripts/` | `download_model.py`, `build_index.py`, `evaluate.py` |

**Chunking.** The chunks follow the structure of the document, not a fixed length: one topic = one
chunk, so a list of steps or a fee table is never cut in half. Each chunk carries metadata (service,
source section) and search-only keywords (colloquial phrasings) that are never shown to the user.

## 3. Results (measured, not claimed)

Thresholds were tuned on the tuning set only. The **hold-out set was written before tuning and never
used to tune**. Its numbers are the ones to report.

| Metric | Tuning set | **Hold-out set** |
|---|---|---|
| In-scope questions answered with the right section | 85% (46/54) | **73% (22/30)** |
| Answered with the wrong section | 1 | **1** |
| Valid questions refused ("I can't answer") | 7 | **7** |
| Out-of-scope questions correctly refused | 100% (18/18) | **75% (9/12)** |
| Calculator correct | 100% (7/7) | **100% (3/3)** |
| Invented facts or numbers | 0 | **0** (by design) |

What the failures look like:
- **False refusals** (the most common): short or vague questions such as "عنوان المركز ايه؟". The
  system is deliberately strict, and a refusal always gives the center's email.
- **Out-of-scope questions that got answered**, e.g. "شروط القبول في الدكتوراه" returned the
  *degree requirements* section. That is real guide text, but not what was asked. The "From the
  guide: …" label makes this visible to the user.

Experiments that were measured and **rejected**:
- Raw cosine threshold: relevant and irrelevant questions overlap (both 0.80–0.86). Replaced by a
  margin-over-median gate.
- Multi-vector indexing (one extra vector per keyword phrase): no gain on the hold-out set and more
  wrong answers. Kept behind `MULTI_VECTOR=1`, off by default.

Reproduce: `python scripts/evaluate.py --holdout`

## 4. The answerability gate

`margin = cosine(best chunk) − median cosine(all chunks)`. For an off-topic question every chunk
scores about the same; for a real question one chunk stands out. A question is answered if any of
these holds:

- `margin ≥ STRONG_MARGIN` (0.07)
- `margin ≥ MIN_MARGIN` (0.05) **and** BM25 keyword score `≥ MIN_BM25` (6)
- BM25 `≥ STRONG_BM25` (8): a very specific keyword match

It is refused if the best match is an out-of-scope guard, or if a guard in the top 3 has stronger
keyword evidence than the chosen answer. All values are in `rag/config.py` and can be overridden
with environment variables.

## 5. Run locally

```bash
pip install -r requirements.txt
python scripts/download_model.py     # ~135 MB from Hugging Face (Xenova/multilingual-e5-small)
python scripts/build_index.py
uvicorn app.main:app --port 8000      # open http://localhost:8000
python -m pytest tests/               # calculator tests
python scripts/evaluate.py --holdout  # quality report
```

## 6. Deploy

The `Dockerfile` downloads the model and builds the index **at build time**, so the running
container needs no internet. It needs ~1 GB RAM and 1 CPU.
*(The Dockerfile has not been test-built yet. Every step it runs was verified individually.)*

- **Hugging Face Spaces (free):** create a *Docker* Space, push this folder, and set the variable
  `PORT=7860`.
- **Render / Railway / any VPS:** deploy the Dockerfile; the platform's `PORT` is picked up automatically.

**Embed in the Academy website** (e.g. Joomla custom HTML module):

```html
<iframe src="https://YOUR-DEPLOYED-URL/" style="width:100%;max-width:480px;height:640px;border:0"
        title="مساعد مركز الاستشارات والبحوث والتطوير"></iframe>
```

To host only the widget on the website and the API elsewhere, open the widget as
`index.html?api=https://YOUR-API-URL`, and set `ALLOWED_ORIGINS=https://www.sadatacademy.edu.eg`
on the server.

**API:** `POST /api/chat {"question": "..."}` returns `answer`, `answer_html` (escaped, with every
link and email clickable), `route`, `answered`, `sources`, `suggestions`. Interactive docs are at `/api/docs`.

## 7. Updating the knowledge

1. Edit `knowledge/guide_ar.md` / `guide_en.md` (same ids), or `knowledge/fees.json` for any fee.
2. `python scripts/build_index.py`
3. `python scripts/evaluate.py --holdout`. If the numbers drop, don't deploy.
4. Read `logs/questions.jsonl` every week: refused questions show what the guide is missing. Add them
   to the guide or to `out_of_scope.md`, then add them to `eval/eval_set.json`, **never** to the
   hold-out set.

The logs mask long numbers (national ID, passport, phone) and emails. They also feed the dashboard
team: the most asked topics, refusal rate, and language.

## 7b. Journal routing (doctor's request)

The researcher asks "أنشر بحثي في أنهي مجلة؟" and the assistant shows one button per research field. A click returns the
suggested journal with its link, fields and frequency. Fields that fit both journals, or "not sure", show both. If the
question already names one field ("انشر فين بحث عن السياحة؟") the answer comes directly; if it names two, the assistant
asks rather than guesses.

The map in `knowledge/journals.json` is **a team proposal** (`routing_status: "proposed"`), built from each journal's
published fields, and every answer says the editorial board decides. When Mr. Nader confirms the map, edit the
`journals` list of each field and set `routing_status` to `"approved"`; the note changes automatically. No index rebuild
is needed.

## 8. Data sources and assumptions (confirm with the center before go-live)

| Content | Source |
|---|---|
| Procedures, rules, formatting, degree table, pledge, international (USD) fees | Procedural guide for international researchers (ver2) |
| Egyptian (EGP) fees, Egyptian request-form fields | The center's services guide (`crdc_guide_v3`), which states it follows the Egyptian procedural guide. **The Egyptian guide itself was not available to verify.** |
| Similarity limit < 25%, duration 10 days to a month, fees paid at once, obligation to use the center | Clarifications provided by the team from the center, marked "توضيحات المركز" in the source line |
| Re-test fee for Egyptians | Not in any source, so it is left out (`null` in fees.json) |

## 9. Limitations and next steps

- Hold-out coverage is 73%. The cheapest gain is **more real questions from the logs**, not a
  bigger model.
- A small LLM can later be added **as a verifier only**: "does chunk X answer question Y? yes/no".
  It still writes nothing, so the no-hallucination guarantee holds. Do this only with the center's
  approval to send questions to an external API.
- The calculator handles one service at a time. For a full degree package, use the calculator in the
  services guide page.
