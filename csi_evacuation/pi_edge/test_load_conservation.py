import unittest
import edge_core
from dynamic_routing import WeightParameters


class LoadConservationTests(unittest.TestCase):
    def setUp(self):
        self.old_map, self.old_loads, self.old_evacuated = edge_core.map_config, edge_core.edge_loads, edge_core.evacuated_load
        edge_core.map_config = {"areas": [{"id": "a", "type": "room"}, {"id": "j", "type": "room"}, {"id": "x", "type": "exit"}], "edges": [
            {"id": "source", "areaA_id": "a", "areaB_id": "j", "length": 5, "widthMeters": 2, "capacityPeople": 10, "flowCapacity": 10},
            {"id": "target", "areaA_id": "j", "areaB_id": "x", "length": 5, "widthMeters": 2, "capacityPeople": 20, "flowCapacity": 10},
        ]}
        edge_core.edge_loads = {"source": 5.0, "target": 0.0}; edge_core.evacuated_load = 0.0

    def tearDown(self):
        edge_core.map_config, edge_core.edge_loads, edge_core.evacuated_load = self.old_map, self.old_loads, self.old_evacuated

    def test_transfer_conserves_continuous_load_across_different_capacities(self):
        edges = {item["id"]: item for item in edge_core.map_config["edges"]}
        edge_core.advance_loads(edges, {"x"}, {"j": 1, "a": 2}, {"j": [{"next_area": "x", "edge_id": "target", "share": 1.0, "allocated_load": None}]})
        self.assertAlmostEqual(sum(edge_core.edge_loads.values()) + edge_core.evacuated_load, 5.0)
        self.assertGreater(edge_core.edge_loads["target"], 0.0)
        self.assertLessEqual(edge_core.edge_loads["target"], 20.0)
        self.assertGreaterEqual(edge_core.edge_loads["source"], 0.0)

    def test_simultaneous_arrivals_never_exceed_target_flow(self):
        edge_core.map_config = {"areas": [{"id": "a"}, {"id": "b"}, {"id": "j"}, {"id": "x", "type": "exit"}], "edges": [
            {"id": "s1", "areaA_id": "a", "areaB_id": "j", "length": 5, "widthMeters": 1, "capacityPeople": 20, "flowCapacity": 10},
            {"id": "s2", "areaA_id": "b", "areaB_id": "j", "length": 5, "widthMeters": 1, "capacityPeople": 20, "flowCapacity": 10},
            {"id": "target", "areaA_id": "j", "areaB_id": "x", "length": 5, "widthMeters": 1, "capacityPeople": 20, "flowCapacity": 1},
        ]}
        edge_core.edge_loads = {"s1": 5.0, "s2": 5.0, "target": 0.0}
        edges = {item["id"]: item for item in edge_core.map_config["edges"]}
        edge_core.advance_loads(edges, {"x"}, {"j": 1, "a": 2, "b": 2}, {"j": [{"next_area": "x", "edge_id": "target", "share": 1.0, "allocated_load": None}]})
        self.assertLessEqual(edge_core.edge_loads["target"], 1.0)
        self.assertAlmostEqual(sum(edge_core.edge_loads.values()) + edge_core.evacuated_load, 10.0)
