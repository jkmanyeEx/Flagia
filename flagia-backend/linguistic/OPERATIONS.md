# Korean linguistic analysis

This implementation adds a learned morphology/syntax classifier, a fine-tuned Korean contextual classifier, and conservative revision analysis to the existing five-metric engine. Language deductions are active immediately after inference: 0, 15, 35 or 65 points, clamped at zero. These are policy deductions, not probabilities.

## Local model preparation

Run from `flagia-backend` with Python 3.10 or later:

```sh
python3 -m venv .venv-linguistic
.venv-linguistic/bin/python -m pip install -r linguistic/requirements.txt
.venv-linguistic/bin/python linguistic/prepare_data.py
HF_HOME=.linguistic-local/hf-cache .venv-linguistic/bin/python linguistic/train.py \
  --data .linguistic-local/katfish-essay.jsonl --output .linguistic-local/model
```

Training downloads the official `klue/roberta-small` checkpoint at the revision pinned in `train.py`. The last two transformer layers and classification head are fine-tuned. CPU and Apple MPS training are supported; runtime inference uses CPU. Text is split into bounded, non-overlapping token chunks, and weighted document logits are aggregated before calibration and inference decisions. No suffix is silently discarded.

The public KatFish essay corpus is checksum verified. Training uses human/GPT-4o texts from seven topics; two other topics calibrate thresholds and two more audit the frozen rule. Other generators appear only in calibration/audit. Exact normalized documents are deduplicated. Author identifiers are unavailable, so this does not establish author-independent generalization. Public availability is not a license grant: the upstream repository did not declare a repository license when checked. Corpus and derived model files are kept locally and ignored by Git; review source permissions before redistribution.

The trained local model is available in `.linguistic-local/model`. The runtime can use `FLAGIA_LINGUISTIC_MODEL_DIR` and `FLAGIA_LINGUISTIC_PYTHON` to locate another prepared bundle/environment. No live submission text is sent to an external API, used for automatic training, or logged by the worker. A fresh checkout needs the model/environment prepared; missing assets produce an explicit unevaluated result without deduction.

## Runtime and persistence

The production workflow detects the EC2 Python minor version and uses the same version in Linux CI. It trains and audits the same fixed corpus/model configuration, freezes the CPU dependency set, and transfers the model and Python modules only through the existing SSH release archive. Model weights and raw corpus files are not published as Git objects, Actions artifacts or model caches. Linux weights can differ from the initial macOS training run; the deployed bundle's `manifest.json` and workflow audit output are authoritative for that release.

Before switching releases, EC2 creates/reuses a shared virtual environment identified by the frozen dependency file and runs the offline inference integration test. Each release contains its own immutable model. Health reports release, analysis-engine and model versions without exposing thresholds or paths. The database is backed up before the existing finalized-submission regrade; regrade uses the full language pipeline, preserves prior results on operational analysis failures and returns a failure exit status. A guarded production smoke test uses temporary test-owned accounts/submission, verifies inference, scoring, persistence and permissions, then removes only those fixtures.

Submission finalization stores the legacy result with pending language status and returns immediately. One private resident Python subprocess handles a bounded 64-job waiting queue to accommodate classroom submission bursts. Inference runs outside the Node event loop. Worker startup is limited to 90 seconds and each active request to 120 seconds. Failure, unsupported scope or queue overflow is unevaluated, never a fabricated zero classifier score. Staff may retry.

The background result recalculates the transcription filter with semantic evidence, then applies the separate language deduction once. Both the JSON result and dashboard score/status columns are updated. Writes check the final text, final submission status and current source fingerprint; stale jobs cannot overwrite a newer analysis. Cache identity includes engine, source, model and scoring-policy versions. Pending work resumes on an analysis read after restart. The analysis view polls only while pending and refreshes on completion notifications.

The existing SQL schema is sufficient; this patch adds no columns or migrations. Students receive only score/status, session summary and pending stage, including from submission responses. Detailed classifier scores, thresholds, feature contributions and revision excerpts remain staff-only.

## Scope and limitations

- Initial scope: primarily Korean prose, 200–12,000 characters and at least three sentences. Creative mode, code and unsupported language are unevaluated. Length limits are initial engineering limits, not validated universal linguistic cutoffs. Genre is not automatically certified merely because a text passes these checks.
- Review/strong thresholds are empirical human-score 99th/99.9th percentiles. They are explicitly provisional and do **not** establish 1%/0.1% false-positive guarantees. The complete Flagia pipeline needs actual writing-session validation.
- Semantic support compares complete sentences observed in adjacent checkpoints at least one second apart. Negation, quantifier, number and selected causal/conditional markers identify change candidates; other vocabulary changes are rewording/uncertain. It is not a full logical or entailment model.
- Long histories sample 48 adjacent checkpoint pairs with explicit segment boundaries. Counts describe observed candidates, not all edits. Transient IME states, pure spacing changes, isolated observations, and duplicated timestamps receive no semantic credit. Frame offsets remain UTF-16 until reconstruction is complete.
- Only changed marker/lemma lengths supplement existing divergence, capped at 25%; a whole sentence is never credited for changing one word. Semantic evidence does not add a new penalty, and it is not reused for the language deduction. No revision or missing history alone adds a penalty.
- Extensive human rewriting, mixed authorship, new generators, allowed grammar correction beyond the tested spacing control, and actual reports are not validated by this essay-only benchmark.

## Verification

```sh
npm run build
npm run test:engine
npm run test:linguistic
npm run test:linguistic:runtime
npm run test:linguistic:submission
npm run test:replay-protocol
.venv-linguistic/bin/python -m unittest discover -s linguistic -p 'test_*.py' -v
```

The runtime/submission tests require prepared model files. The submission test uses an in-memory SQL adapter and never connects to a live database. In environments that restrict the `tsx` CLI's IPC socket, use `node --import tsx` followed by the same TypeScript test path. Frontend checks are `npm run build` and `npm run test:replay`.

## Primary references

- [KatFishNet code and corpus](https://github.com/Shinwoo-Park/katfishnet)
- [Official Korean encoder](https://huggingface.co/klue/roberta-small)
- [Kiwi Python morphology API](https://github.com/bab2min/kiwipiepy)
- [Transformers sequence-classification documentation](https://huggingface.co/docs/transformers/tasks/sequence_classification)
