import random
import unittest

from behavior import BehaviorConfig, distribute_choices
from forecasting import ForecastConfig, LoadForecaster


class ForecastTests(unittest.TestCase):
    def test_projection_is_repeatable_and_p90_is_conservative(self):
        forecaster = LoadForecaster({"a": 10}, ForecastConfig(horizon_seconds=3, lookahead_seconds=2, scenarios=5, seed=9))

        def transition(loads, _rng):
            return {"a": min(10, loads["a"] + 2)}, {}

        first = forecaster.project({"a": 2}, transition)
        second = forecaster.project({"a": 2}, transition)
        self.assertEqual(first, second)
        self.assertGreaterEqual(first["edges"]["a"]["p90"][1], first["edges"]["a"]["median"][1])
        self.assertEqual(first["edges"]["a"]["planning_k"], 0.6)

    def test_unsafe_familiar_route_is_rejected_not_selected(self):
        choices = [{"edge_id": "safe", "share": 1.0}]
        config = BehaviorConfig(guidance_compliance=0.5, familiar_routes={"area": "blocked"})
        result, rejected = distribute_choices(choices, "area", config, random.Random(1), {"safe": 0})
        self.assertEqual(result[0][0]["edge_id"], "safe")
        self.assertEqual(rejected, 0.5)


if __name__ == "__main__":
    unittest.main()
