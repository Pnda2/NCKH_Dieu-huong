"""Protocol-level smoke tests; broker connectivity is exercised by start_all."""

import unittest

from guidance_controller import GuidanceController


class GuidanceProtocolTests(unittest.TestCase):
    def test_speaker_command_mapping(self):
        self.assertEqual(GuidanceController._speaker_command("LEFT"), "EVACUATE_LEFT")
        self.assertEqual(GuidanceController._speaker_command("NO_SAFE_ROUTE"), "SHELTER_IN_PLACE")
        self.assertEqual(GuidanceController._occupancy_ratio({"status": "UNKNOWN"}), 1.0)

    def test_guidance_uses_share_not_route_cost(self):
        controller = GuidanceController()
        controller.configure({
            "areas": [{"id": "a"}, {"id": "b"}, {"id": "c"}],
            "edges": [
                {"id": "cheap", "areaA_id": "a", "areaB_id": "b", "widthMeters": 1},
                {"id": "expensive", "areaA_id": "a", "areaB_id": "c", "widthMeters": 1},
            ],
        })

        class Client:
            def publish(self, *_args, **_kwargs):
                return None

        state = controller.update(Client(), {
            "a": [
                {"next_area": "b", "edge_id": "cheap", "cost": 1, "share": 1.0},
                {"next_area": "c", "edge_id": "expensive", "cost": 99, "share": 0.0},
            ],
        }, {"a": 1, "b": 0, "c": 0}, {"cheap": 0, "expensive": 0}, set(), set())
        self.assertEqual(state["decisions"]["a"]["next_edge"], "cheap")


if __name__ == "__main__":
    unittest.main()
