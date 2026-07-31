import unittest
from evacuation_optimizer import EvacuationOptimizer, OptimizerConfig, fallback_routes


class OptimizerTests(unittest.TestCase):
    def setUp(self):
        self.optimizer = EvacuationOptimizer(OptimizerConfig(timeout_seconds=1))

    def test_single_route_is_full_share(self):
        routes, status = self.optimizer.optimize({"a": [("b", "e1", 1)]}, {"a": 5}, {"e1": 5})
        self.assertEqual(status, "optimal")
        self.assertEqual(routes["a"], [("b", "e1", 1.0)])

    def test_two_routes_respect_flow_limits_and_split(self):
        routes, status = self.optimizer.optimize({"a": [("b", "e1", 1), ("c", "e2", 1)]}, {"a": 10}, {"e1": 4, "e2": 6})
        self.assertEqual(status, "optimal")
        self.assertEqual(len(routes["a"]), 2)
        self.assertAlmostEqual(sum(item[2] for item in routes["a"]), 1.0)

    def test_split_does_not_increase_completion_estimate_vs_shortest_only(self):
        routes, status = self.optimizer.optimize({"a": [("b", "short", 1), ("c", "wide", 2)]}, {"a": 10}, {"short": 4, "wide": 6})
        self.assertEqual(status, "optimal")
        optimizer_flow = sum({"short": 4, "wide": 6}[edge] * share for _target, edge, share in routes["a"])
        baseline_seconds = 10 / 4  # shortest-only edge
        optimized_seconds = 10 / optimizer_flow
        self.assertLessEqual(optimized_seconds, baseline_seconds)

    def test_fallback_is_safe(self):
        self.assertEqual(fallback_routes({"a": [("b", "e", 3)]})["a"], [("b", "e", 1.0)])
