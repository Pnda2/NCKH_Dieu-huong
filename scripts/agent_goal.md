# WiEvac Phase 1 autonomous goal

Bring the current Phase 1 implementation to a stable, testable state without changing its intended scientific model.

Definition of done:
1. All Python Phase 1 tests pass.
2. Backend tests and syntax checks pass.
3. Frontend unit tests pass.
4. Frontend lint passes.
5. Frontend production build passes.
6. D* Lite remains the route planner and supports incremental rerouting.
7. Congestion/load, corridor width/capacity, blocked routes and hazards are handled safely.
8. A reachable route never targets a blocked/full/invalid corridor.
9. Guidance output remains compatible with the Phase 1 contract: at most two routes, normalized probabilities, deterministic fallback.
10. Existing MQTT/device/backend/UI behavior is not intentionally removed or weakened.

Optimization priority:
correctness > safety > regression resistance > maintainability > performance > UI polish.

Never make an evaluator pass by weakening tests, excluding files, disabling lint rules, hard-coding expected outputs, swallowing failures, or changing the goal.
