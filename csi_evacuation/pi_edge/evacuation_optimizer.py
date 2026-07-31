"""Small continuous MPC flow optimizer layered on top of D* Lite candidates."""

from __future__ import annotations

import math
from dataclasses import dataclass

try:
    from scipy.optimize import linprog
except ImportError:  # The caller must safely fall back when SciPy is unavailable.
    linprog = None


@dataclass(frozen=True)
class OptimizerConfig:
    horizon_seconds: float = 30.0
    timeout_seconds: float = 1.0
    route_change_penalty: float = 0.5
    min_route_improvement: float = 0.05


class OptimizerError(RuntimeError):
    pass


def fallback_routes(candidates: dict[str, list[tuple[str, str, float]]]) -> dict[str, list[tuple[str, str, float]]]:
    return {area: [(items[0][0], items[0][1], 1.0)] if items else [] for area, items in candidates.items()}


class EvacuationOptimizer:
    """Linear first-step flow allocation; all physical movement remains in edge_core."""

    def __init__(self, config: OptimizerConfig | None = None):
        self.config = config or OptimizerConfig()

    def optimize(self, candidates, area_loads, edge_limits, blocked_edges=frozenset(), previous_routes=None):
        if linprog is None:
            raise OptimizerError("scipy_unavailable")
        previous_routes = previous_routes or {}
        variables = []
        for area_id, options in candidates.items():
            usable = [item for item in options if item[1] not in blocked_edges and math.isfinite(item[2])][:2]
            for target, edge_id, cost in usable:
                variables.append((area_id, target, edge_id, max(0.0, float(cost))))
        if not variables:
            return {}, "infeasible"
        # Minimize predicted travel, queue pressure, and unnecessary deviations.
        objective = []
        for area, _target, edge, cost in variables:
            prior = {item[1] for item in previous_routes.get(area, []) if item[2] > 0}
            # A large evacuation reward lexicographically prioritizes moving
            # safe load before minimizing travel/route churn.
            objective.append(cost + (self.config.route_change_penalty if prior and edge not in prior else 0.0) - 1_000_000.0)
        a_ub, b_ub = [], []
        for area, load in area_loads.items():
            row = [1.0 if variable[0] == area else 0.0 for variable in variables]
            a_ub.append(row); b_ub.append(max(0.0, float(load)))
        for edge, limit in edge_limits.items():
            row = [1.0 if variable[2] == edge else 0.0 for variable in variables]
            a_ub.append(row); b_ub.append(max(0.0, float(limit)))
        result = linprog(objective, A_ub=a_ub, b_ub=b_ub, bounds=(0, None), method="highs", options={"time_limit": self.config.timeout_seconds})
        if not result.success:
            return {}, "infeasible" if result.status == 2 else "error"
        flows = {}
        for variable, amount in zip(variables, result.x):
            if amount > 1e-8:
                flows.setdefault(variable[0], []).append((variable[1], variable[2], float(amount)))
        routes = {}
        for area, items in flows.items():
            total = sum(item[2] for item in items)
            if total > 0:
                routes[area] = [(target, edge, value / total) for target, edge, value in sorted(items, key=lambda item: -item[2])[:2]]
        # Empty sources still get their safe best route for device guidance.
        for area, options in candidates.items():
            routes.setdefault(area, fallback_routes({area: options})[area])
        return routes, "optimal"
