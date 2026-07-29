import math
import unittest

import edge_core


class WidthAwareRoutingTests(unittest.TestCase):
    def setUp(self):
        edge_core.map_config = {
            "areas": [
                {"id": "start", "type": "room", "floor": 1},
                {"id": "exit_a", "type": "exit", "floor": 1},
                {"id": "exit_b", "type": "exit", "floor": 1},
            ],
            "edges": [
                {
                    "id": "narrow",
                    "areaA_id": "start",
                    "areaB_id": "exit_a",
                    "length": 10,
                    "widthMeters": 1,
                },
                {
                    "id": "wide",
                    "areaA_id": "start",
                    "areaB_id": "exit_b",
                    "length": 10,
                    "widthMeters": 2,
                },
            ],
        }
        edge_core.blocked_edges = set()
        edge_core.blocked_exits = set()
        edge_core.previous_next_edge = {}

    def test_same_occupancy_prefers_wider_corridor(self):
        graph, edge_map = edge_core.build_graph()
        _, _, routes = edge_core.compute_routes(
            graph, edge_map, {"narrow": 0.5, "wide": 0.5}
        )

        probabilities = {
            edge_id: probability
            for _, edge_id, probability in routes["start"]
        }
        self.assertAlmostEqual(probabilities["narrow"], 1 / 3, places=3)
        self.assertAlmostEqual(probabilities["wide"], 2 / 3, places=3)
        self.assertAlmostEqual(sum(probabilities.values()), 1.0, places=6)

    def test_receiving_capacity_combines_width_and_occupancy(self):
        narrow, wide = edge_core.map_config["edges"]
        self.assertTrue(
            math.isclose(
                edge_core.calculate_receiving_capacity(narrow, 0.5),
                0.5,
            )
        )
        self.assertTrue(
            math.isclose(
                edge_core.calculate_receiving_capacity(wide, 0.5),
                1.0,
            )
        )

    def test_very_small_secondary_route_is_hidden(self):
        edge_core.map_config["edges"][1]["widthMeters"] = 20
        graph, edge_map = edge_core.build_graph()
        _, _, routes = edge_core.compute_routes(
            graph, edge_map, {"narrow": 0.5, "wide": 0.5}
        )

        self.assertEqual(len(routes["start"]), 1)
        self.assertEqual(routes["start"][0][1], "wide")
        self.assertEqual(routes["start"][0][2], 1.0)


if __name__ == "__main__":
    unittest.main()
