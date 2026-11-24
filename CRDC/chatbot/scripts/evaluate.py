"""Evaluate the assistant and tune the refusal thresholds.

    python scripts/evaluate.py          # report with current thresholds
    python scripts/evaluate.py --tune   # grid-search thresholds, then report

Metrics:
  in-scope accuracy   – answered with an acceptable chunk
  wrong answers       – answered with the WRONG chunk (the metric that must be ~0)
  false refusals      – refused a question the guide does answer
  refusal accuracy    – out-of-scope questions correctly refused
  calculator accuracy – every expected total appears in the answer
"""
import argparse
import itertools
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from rag import config  # noqa: E402
from rag.engine import Engine  # noqa: E402


def run(engine: Engine, data: dict, verbose: bool = True) -> dict:
    ok = wrong = false_ref = 0
    fails = []
    for item in data["retrieval"]:
        a = engine.ask(item["q"])
        if not a.answered:
            false_ref += 1
            fails.append(f"FALSE REFUSAL  {item['q']}  (best={a.top_id} {a.score:.3f})")
        elif a.top_id in item["expect"] or (a.route == "calculator" and "fees" in str(item["expect"])):
            ok += 1
        else:
            wrong += 1
            fails.append(f"WRONG          {item['q']}  -> {a.top_id} (expected {item['expect']})")
    ref_ok = 0
    for q in data["refuse"]:
        a = engine.ask(q)
        if not a.answered:
            ref_ok += 1
        else:
            fails.append(f"SHOULD REFUSE  {q}  -> {a.route}/{a.top_id} {a.score}")
    calc_ok = 0
    for item in data["calc"]:
        a = engine.ask(item["q"])
        good = a.route == "calculator" and all(m in a.answer for m in item["must"]) \
            and not any(m in a.answer for m in item.get("must_not", []))
        calc_ok += good
        if not good:
            fails.append(f"CALC FAIL      {item['q']}  -> {a.answer[:120]!r}")
    n_in, n_out, n_calc = len(data["retrieval"]), len(data["refuse"]), len(data["calc"])
    res = {"in_scope_accuracy": ok / n_in, "wrong_answers": wrong, "false_refusals": false_ref,
           "refusal_accuracy": ref_ok / n_out, "out_of_scope_answered": n_out - ref_ok,
           "calculator_accuracy": calc_ok / n_calc, "n": {"in_scope": n_in, "out_of_scope": n_out, "calc": n_calc}}
    if verbose:
        print(json.dumps(res, indent=2))
        print("\n".join(fails) or "No failures.")
    return res


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--tune", action="store_true", help="grid-search thresholds on the tuning set")
    ap.add_argument("--holdout", action="store_true", help="report on the held-out set (never tune on it)")
    args = ap.parse_args()
    data = json.loads((ROOT / "eval" / "eval_set.json").read_text(encoding="utf-8"))
    engine = Engine()
    if args.tune:
        best = None
        for lo, hi, bm, sbm in itertools.product([0.02, 0.03, 0.04, 0.05, 0.06],
                                                 [0.06, 0.07, 0.08, 0.09, 0.10],
                                                 [2.0, 3.0, 4.0, 5.0, 6.0],
                                                 [8.0, 10.0, 12.0, 14.0, 999.0]):
            if hi < lo or sbm < bm:
                continue
            config.MIN_MARGIN, config.STRONG_MARGIN, config.MIN_BM25, config.STRONG_BM25 = lo, hi, bm, sbm
            r = run(engine, data, verbose=False)
            errors = r["wrong_answers"] + r["out_of_scope_answered"]       # answering when it shouldn't
            key = (errors, r["false_refusals"], -hi, -lo, -sbm)                   # 1) fewest bad answers 2) fewest refusals 3) prefer stricter
            if best is None or key < best[0]:
                best = (key, (lo, hi, bm, sbm), r)
        (lo, hi, bm, sbm) = best[1]
        print(f"BEST  MIN_MARGIN={lo}  STRONG_MARGIN={hi}  MIN_BM25={bm}  STRONG_BM25={sbm}")
        config.MIN_MARGIN, config.STRONG_MARGIN, config.MIN_BM25, config.STRONG_BM25 = lo, hi, bm, sbm
    print("=== TUNING SET ===")
    run(engine, data)
    if args.holdout:
        print("\n=== HOLD-OUT SET (not used for tuning) ===")
        run(engine, json.loads((ROOT / "eval" / "holdout_set.json").read_text(encoding="utf-8")))
