// Evaluate the browser port of Murshid on the same question sets as the Python engine.
//
//   MURSHID_MODEL_DIR=/path/to/multilingual-e5-small node --experimental-strip-types scripts/murshid-eval.ts [--holdout] [--check]
//
// --check (CI) exits with an error when fee text differs from Python, the calculator misses a case,
// or the model-based results fall below the measured baseline for that set.
//
// The model dir needs model_quantized.onnx and tokenizer.json (CRDC/chatbot/scripts/download_model.py).
// Without MURSHID_MODEL_DIR only limited mode (no model: calculator, journals, greetings) is evaluated.
import fs from 'node:fs'
import path from 'node:path'
import * as ort from 'onnxruntime-web'
import { createEmbedder } from '../src/murshid/embedder.ts'
import { MurshidEngine } from '../src/murshid/engine.ts'
import { withLiveFees } from '../src/murshid/fees.ts'
import type { Fees } from '../src/murshid/fees.ts'
import type { MurshidIndex } from '../src/murshid/types.ts'

const here = path.dirname(new URL(import.meta.url).pathname)
const chatbot = path.resolve(here, '../../chatbot')
const index = JSON.parse(fs.readFileSync(path.resolve(here, '../public/murshid/index.json'), 'utf8')) as MurshidIndex
const fees = JSON.parse(fs.readFileSync(path.join(chatbot, 'knowledge/fees.json'), 'utf8')) as Fees
const setName = process.argv.includes('--holdout') ? 'holdout_set.json' : 'eval_set.json'
const check = process.argv.includes('--check')
// Baseline measured on 2026-11-24 (identical to the Python engine). Raise it when results improve.
const BASELINE: Record<string, { minInScope: number; maxWrong: number; maxOutOfScopeAnswered: number }> = {
  'eval_set.json': { minInScope: 0.85, maxWrong: 1, maxOutOfScopeAnswered: 0 },
  'holdout_set.json': { minInScope: 0.73, maxWrong: 1, maxOutOfScopeAnswered: 3 },
}
const problems: string[] = []
const data = JSON.parse(fs.readFileSync(path.join(chatbot, 'eval', setName), 'utf8'))

// 1) Fee text built in TypeScript must equal the Python-generated text (only the source label differs).
let feeMismatch = 0
for (const [a, b] of withLiveFees(index.chunks, fees).map((c, i) => [c, index.chunks[i]])) {
  if (a.text !== b.text) {
    feeMismatch++
    console.log(`FEE TEXT DIFFERS ${a.id}/${a.lang}`)
  }
}
console.log(`fee chunk text: ${feeMismatch ? feeMismatch + ' mismatches' : 'identical to Python'}`)
if (feeMismatch) problems.push('fee chunk text differs from the Python engine')

async function run(engine: MurshidEngine) {
  let ok = 0, wrong = 0, falseRef = 0, refOk = 0, calcOk = 0
  const fails: string[] = []
  for (const item of data.retrieval) {
    const a = await engine.ask(item.q)
    if (!a.answered) { falseRef++; fails.push(`FALSE REFUSAL  ${item.q}  (best=${a.topId})`) }
    else if (item.expect.includes(a.topId) || (a.route === 'calculator' && String(item.expect).includes('fees'))) ok++
    else { wrong++; fails.push(`WRONG          ${item.q}  -> ${a.topId} (expected ${item.expect})`) }
  }
  for (const q of data.refuse) {
    const a = await engine.ask(q)
    if (!a.answered) refOk++
    else fails.push(`SHOULD REFUSE  ${q}  -> ${a.route}/${a.topId}`)
  }
  for (const item of data.calc) {
    const a = await engine.ask(item.q)
    const good = a.route === 'calculator' && item.must.every((m: string) => a.text.includes(m)) &&
      !(item.must_not ?? []).some((m: string) => a.text.includes(m))
    if (good) calcOk++
    else fails.push(`CALC FAIL      ${item.q}`)
  }
  const nIn = data.retrieval.length, nOut = data.refuse.length, nCalc = data.calc.length
  console.log(JSON.stringify({
    mode: engine.mode, in_scope_accuracy: +(ok / nIn).toFixed(3), wrong_answers: wrong, false_refusals: falseRef,
    refusal_accuracy: +(refOk / nOut).toFixed(3), out_of_scope_answered: nOut - refOk,
    calculator_accuracy: +(calcOk / nCalc).toFixed(3), n: { in_scope: nIn, out_of_scope: nOut, calc: nCalc },
  }, null, 2))
  console.log(fails.join('\n') || 'No failures.')
  if (calcOk < nCalc) problems.push(`${engine.mode}: calculator missed ${nCalc - calcOk} case(s)`)
  if (engine.mode === 'limited' && nOut - refOk > 0) problems.push('limited mode answered an out-of-scope question')
  if (engine.mode === 'hybrid') {
    const b = BASELINE[setName]
    if (ok / nIn < b.minInScope) problems.push(`in-scope accuracy ${(ok / nIn).toFixed(3)} < ${b.minInScope}`)
    if (wrong > b.maxWrong) problems.push(`wrong answers ${wrong} > ${b.maxWrong}`)
    if (nOut - refOk > b.maxOutOfScopeAnswered) problems.push(`out-of-scope answered ${nOut - refOk} > ${b.maxOutOfScopeAnswered}`)
  }
}

console.log(`\n=== ${setName} ===`)
const dir = process.env.MURSHID_MODEL_DIR
if (dir) {
  const embed = await createEmbedder(ort, fs.readFileSync(path.join(dir, 'model_quantized.onnx')),
    JSON.parse(fs.readFileSync(path.join(dir, 'tokenizer.json'), 'utf8')))
  await run(new MurshidEngine(index, { fees, embed }))
}
await run(new MurshidEngine(index, { fees, embed: null }))
if (check && problems.length) {
  console.error('\nCHECK FAILED:\n  ' + problems.join('\n  '))
  process.exit(1)
}
if (check) console.log('\nCHECK PASSED')
