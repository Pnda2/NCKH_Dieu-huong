import heapq
import math
import unittest

from dynamic_routing import (
    DynamicEvacuationRouter,
    WeightParameters,
    corridor_capacity,
    dynamic_edge_cost,
)


PARAMETERS = WeightParameters(
    free_walking_speed=1.0,
    gamma=1.0,
    delta=2.0,
    hazard_block_threshold=10.0,
    people_per_square_meter=2.0,
)
ROUTING_PARAMETERS = WeightParameters(
    free_walking_speed=1.0,
    gamma=3.0,
    delta=2.0,
    hazard_block_threshold=10.0,
    people_per_square_meter=2.0,
)


def edge(edge_id, left, right, length=10, capacity=50):
    return {
        "id": edge_id,
        "areaA_id": left,
        "areaB_id": right,
        "length": length,
        "widthMeters": 2,
        "capacityPeople": capacity,
    }


def sample_map():
    return {
        "areas": [
            {"id": "start", "type": "room"},
            {"id": "upper", "type": "room"},
            {"id": "lower", "type": "room"},
            {"id": "exit_a", "type": "exit"},
            {"id": "exit_b", "type": "exit"},
        ],
        "edges": [
            edge("short_a", "start", "upper", 5),
            edge("to_exit_a", "upper", "exit_a", 5),
            edge("long_b", "start", "lower", 8),
            edge("to_exit_b", "lower", "exit_b", 8),
        ],
    }


class DynamicWeightTests(unittest.TestCase):
    def test_empty_corridor_is_base_time_plus_hazard(self):
        value = dynamic_edge_cost(edge("e", "a", "b", 10, 50), 0, 3, parameters=PARAMETERS)
        self.assertEqual(value, 13)

    def test_required_numeric_example(self):
        value = dynamic_edge_cost(edge("e", "a", "b", 10, 50), 25, 3, parameters=PARAMETERS)
        self.assertAlmostEqual(value, 15.5)

    def test_weight_is_monotonic_with_people(self):
        corridor = edge("e", "a", "b", 10, 100)
        values = [dynamic_edge_cost(corridor, people, parameters=PARAMETERS) for people in (0, 10, 25, 50, 75)]
        self.assertEqual(values, sorted(values))

    def test_full_or_invalid_corridor_is_blocked_safely(self):
        self.assertTrue(math.isinf(dynamic_edge_cost(edge("full", "a", "b", 10, 50), 50, parameters=PARAMETERS)))
        self.assertTrue(math.isinf(dynamic_edge_cost(edge("bad", "a", "b", 10, 0), 0, parameters=PARAMETERS)))
        self.assertEqual(corridor_capacity({"length": 10, "widthMeters": 2}, PARAMETERS), 40)


class DStarLiteIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.router = DynamicEvacuationRouter(sample_map(), ROUTING_PARAMETERS)
        self.empty = {edge_id: 0.0 for edge_id in self.router.edges}
        self.router.update(self.empty)

    def test_static_result_matches_shortest_path_cost(self):
        route = self.router.route_from("start")
        self.assertTrue(route["reachable"])
        self.assertEqual(route["edge_ids"], ["short_a", "to_exit_a"])
        self.assertAlmostEqual(route["cost"], 10.0)

        graph = {"start": [("upper", 5), ("lower", 8)], "upper": [("exit_a", 5)], "lower": [("exit_b", 8)]}
        queue, distances = [(0, "start")], {"start": 0}
        while queue:
            cost, node = heapq.heappop(queue)
            for nxt, weight in graph.get(node, []):
                candidate = cost + weight
                if candidate < distances.get(nxt, math.inf):
                    distances[nxt] = candidate
                    heapq.heappush(queue, (candidate, nxt))
        self.assertEqual(route["cost"], min(distances["exit_a"], distances["exit_b"]))

    def test_density_change_reroutes_incrementally(self):
        before = self.router.route_from("start")
        planner = self.router.planners["start"]
        self.assertEqual(planner.initialization_count, 1)
        dense = dict(self.empty)
        dense["short_a"] = 0.99
        self.router.update(dense)
        after = self.router.route_from("start")
        self.assertNotEqual(before["next_edge"], after["next_edge"])
        self.assertEqual(planner.initialization_count, 1)
        self.assertGreater(planner.incremental_update_count, 0)

    def test_hazard_can_reroute(self):
        self.router.update(self.empty, {"short_a": 9.0})
        self.assertEqual(self.router.route_from("start")["next_edge"], "long_b")

    def test_no_exit_path_does_not_crash(self):
        self.router.update(self.empty, blocked_edges={"short_a", "long_b"})
        route = self.router.route_from("start")
        self.assertFalse(route["reachable"])
        self.assertEqual(route["edge_ids"], [])

    def test_returns_two_safe_route_candidates(self):
        route = self.router.route_from("start")
        self.assertEqual(len(route["route_candidates"]), 2)
        self.assertEqual({item["edge_id"] for item in route["route_candidates"]}, {"short_a", "long_b"})
        self.assertLess(route["route_candidates"][0]["cost"], route["route_candidates"][1]["cost"])


if __name__ == "__main__":
    unittest.main()
