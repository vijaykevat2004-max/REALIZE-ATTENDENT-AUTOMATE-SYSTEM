# Face Attendance V5 Roadmap (Production-Oriented)

This roadmap upgrades the current strict YuNet + SFace pipeline toward RetinaFace + ArcFace + dedicated anti-spoofing while preserving current production stability.

## Current Baseline

- Frontend: Next.js kiosk + API proxy
- AI service: FastAPI on Render
- Recognition: OpenCV SFace embeddings + strict temporal/quality gates
- Status: `4.0.0-industry-strict` is live

## Target Pipeline

1. RetinaFace detect
2. Face alignment (5-point)
3. Anti-spoof gate
4. ArcFace embedding
5. Cosine similarity
6. Threshold + margin + temporal decision
7. Attendance mark

## Important Threshold Correction

Cosine similarity is stricter at higher values.

- Loose: `0.55`
- Good: `0.65`
- Strict: `0.75`
- Ultra strict: `0.82+`

Do not use `0.30-0.40` for secure attendance; that is too permissive.

## Phase 1 - Service Refactor (No Model Change)

Goal: keep current behavior, but modularize for safe upgrades.

- Split AI service into modules:
  - `services/ai/modules/detector.py`
  - `services/ai/modules/alignment.py`
  - `services/ai/modules/liveness.py`
  - `services/ai/modules/matcher.py`
  - `services/ai/modules/decision.py`
- Keep current APIs unchanged:
  - `/industry-match-json`
  - `/encode-face`
  - `/encode-multi`
  - `/health`
- Add structured debug response keys:
  - `scene`, `quality`, `liveness`, `timing_ms`

Exit criteria:
- Same production output decisions as current strict service
- Added per-stage timings

## Phase 2 - ArcFace + RetinaFace Integration

Goal: improve robustness and identity separation.

- Integrate InsightFace models with CPU-compatible fallback:
  - RetinaFace detector
  - ArcFace recognizer
- Keep OpenCV models as fallback mode for startup safety.
- Add model mode in health:
  - `mode: opencv_strict | insightface_strict`

Exit criteria:
- Same API contract
- InsightFace mode can run on Render plan in acceptable latency

## Phase 3 - Anti-Spoof Hardening

Goal: reduce photo/screen replay success.

- Integrate anti-spoof model (Silent Face or equivalent lightweight ONNX/TFLite variant).
- Decision rule:
  - if spoof score fails => immediate `REJECT`
  - no identity matching attempt when spoof fails
- Add spoof reason codes:
  - `spoof_flat_texture`
  - `spoof_screen_glare`
  - `spoof_model_score`

Exit criteria:
- Spoof attacks rejected with reason codes
- No increase in false accepts

## Phase 4 - Calibration & Evaluation

Goal: move from fixed thresholds to measured thresholds.

- Add evaluation script:
  - input: enrolled samples + genuine attempts + impostor attempts
  - output: FAR/FRR, ROC-like summary, suggested thresholds
- Produce environment-specific thresholds:
  - office-light profile
  - low-light profile

Exit criteria:
- Documented threshold policy by measured data
- Versioned threshold config

## Phase 5 - Realtime & Ops

Goal: production observability and operational control.

- Add WebSocket stream for live decisions and diagnostics (optional).
- Persist unknown attempts (sampled) for admin review.
- Add dashboard metrics:
  - reject reasons distribution
  - avg decision latency
  - FAR/FRR drift indicators

Exit criteria:
- Admin can tune and audit without code changes

## Data & Enrollment Policy

- Enrollment: 20-30 captures recommended per user across angles and lighting.
- Keep only high-quality, single-face, live captures.
- Save:
  - averaged embedding
  - selected raw embeddings (small set)
  - enrollment quality stats

## Security Policy

- Whitelist mode only (registered identities only)
- Single-face required in frame
- High margin required between top-1 and top-2
- Temporal consistency required
- Liveness required
- Cooldown to prevent rapid double-mark

## Rollout Strategy

1. Deploy Phase 1 refactor behind feature flag.
2. Canary Phase 2 model mode for limited users/time windows.
3. Enable anti-spoof hard gate after calibration window.
4. Finalize threshold config from Phase 4 outputs.

## Immediate Next Implementation Tasks

1. Create module skeleton under `services/ai/modules/`.
2. Move existing strict logic into modules without behavior changes.
3. Add `timing_ms` in responses for each stage.
4. Add config object for thresholds in one place.
