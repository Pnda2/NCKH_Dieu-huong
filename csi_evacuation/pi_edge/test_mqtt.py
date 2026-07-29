"""Protocol-level smoke tests; broker connectivity is exercised by start_all."""

import unittest

from guidance_controller import GuidanceController


class GuidanceProtocolTests(unittest.TestCase):
    def test_speaker_command_mapping(self):
        self.assertEqual(GuidanceController._speaker_command("LEFT"), "EVACUATE_LEFT")
        self.assertEqual(GuidanceController._speaker_command("NO_SAFE_ROUTE"), "SHELTER_IN_PLACE")


if __name__ == "__main__":
    unittest.main()
