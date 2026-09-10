import unittest
from evacuation_optimizer import EvacuationOptimizer, OptimizerConfig, fallback_routes


class OptimizerTests(unittest.TestCase):
    def setUp(self):
        self.optimizer = EvacuationOptimizer(OptimizerConfig(timeout_seconds=1))

    def test_single_route_is_full_share(self):
        routes, status = self.optimizer.optimize({"a": [{"next_area": "b", "edge_id": "e1", "cost": 1}]}, {"a": 5}, {"e1": 5})
        self.assertEqual(status, "optimal")
        self.assertEqual(routes["a"][0]["edge_id"], "e1")
        self.assertEqual(routes["a"][0]["share"], 1.0)
        self.assertEqual(routes["a"][0]["allocated_load"], 5.0)

    def test_two_routes_respect_flow_limits_and_split(self):
        routes, status = self.optimizer.optimize({"a": [{"next_area": "b", "edge_id": "e1", "cost": 1}, {"next_area": "c", "edge_id": "e2", "cost": 1}]}, {"a": 10}, {"e1": 4, "e2": 6})
        self.assertEqual(status, "optimal")
        self.assertEqual(len(routes["a"]), 2)
        self.assertAlmostEqual(sum(item["share"] for item in routes["a"]), 1.0)
        self.assertLessEqual(sum(item["allocated_load"] for item in routes["a"] if item["edge_id"] == "e1"), 4)

    def test_split_does_not_increase_completion_estimate_vs_shortest_only(self):
        routes, status = self.optimizer.optimize({"a": [{"next_area": "b", "edge_id": "short", "cost": 1}, {"next_area": "c", "edge_id": "wide", "cost": 2}]}, {"a": 10}, {"short": 4, "wide": 6})
        self.assertEqual(status, "optimal")
        optimizer_flow = sum({"short": 4, "wide": 6}[item["edge_id"]] * item["share"] for item in routes["a"])
        baseline_seconds = 10 / 4  # shortest-only edge
        optimized_seconds = 10 / optimizer_flow
        self.assertLessEqual(optimized_seconds, baseline_seconds)

    def test_fallback_is_safe(self):
        fallback = fallback_routes({"a": [{"next_area": "b", "edge_id": "e", "cost": 3}]})["a"]
        self.assertEqual(fallback[0]["edge_id"], "e")
        self.assertEqual(fallback[0]["share"], 1.0)
        self.assertIsNone(fallback[0]["allocated_load"])
