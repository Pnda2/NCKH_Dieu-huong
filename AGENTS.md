# WiEvac autonomous development contract

## Scope
Work only on Phase 1 of WiEvac in this repository. Product code lives mainly under `csi_evacuation/`.

## Durable goal
Improve Phase 1 until the evaluator passes every required gate while preserving the scientific and architectural contract in `csi_evacuation/PHASE1_GUIDANCE.md`.

Core behavior that must remain true:
- CSI is an estimated normalized occupancy/load signal, not an exact people counter.
- D* Lite owns route planning and incremental replanning.
- The optimizer may split flow across at most two safe routes; it must not replace D* Lite with another routing algorithm.
- Route probabilities sum to 1 when a safe route exists.
- If optimizer fallback is required, one D* Lite route is returned with probability 1.0.
- Blocked, invalid, full, or unsafe corridors must never be selected as usable routes.
- Width/capacity and congestion must affect routing without pretending CSI gives exact head counts.
- Existing device guidance, MQTT command/ACK behavior, backend schema, and UI functionality must not regress.

## Autonomous iteration rules
For each iteration:
1. Read `scripts/agent_goal.md`, the latest evaluator report, and relevant implementation/tests.
2. Identify the highest-impact root cause, not merely the first symptom.
3. Make the smallest coherent production-code changes that improve correctness and maintainability.
4. Run focused checks while developing, then run `python scripts/evaluate_phase1.py` before finishing the iteration.
5. Review your diff for regressions, dead code, accidental API/schema changes, and unsupported assumptions.
6. Do not claim success unless the evaluator reports `PASS`.

## Protected quality gates
Do NOT weaken, delete, skip, rename, or modify evaluator/contract files merely to make checks pass. In particular, do not modify:
- `scripts/evaluate_phase1.py`
- `scripts/codex_loop.ps1`
- `scripts/agent_goal.md`
- `AGENTS.md`
- existing `test_*.py` files
- existing `*.test.js` files

If a protected test exposes a bug, fix production code instead.

## Safety and scope constraints
- Do not push, merge, force-push, delete branches, rewrite Git history, or alter secrets.
- Do not change `.env` credentials or introduce secrets into the repository.
- Do not install unrelated dependencies.
- Preserve backwards compatibility unless the goal explicitly requires a breaking change.
- Prefer deterministic fixes and deterministic tests.
- Do not hide failures with broad exception swallowing, hard-coded pass values, disabled lint rules, or reduced validation.

## Stop conditions
The outer loop controls stopping. Return control after each coherent improvement. If blocked by missing external information or an unsafe/destructive requirement, explain the blocker clearly instead of guessing.
