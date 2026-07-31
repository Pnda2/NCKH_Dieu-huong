import unittest
from csi_layer import CSILayer


class CSILayerTests(unittest.TestCase):
    def test_ema_reduces_noise(self):
        layer = CSILayer(ema_alpha=0.2)
        layer.update("edge", 0.2, now=1)
        state = layer.update("edge", 0.8, now=2)
        self.assertAlmostEqual(state["filtered_k"], 0.32)

    def test_stale_and_invalid_are_not_empty(self):
        layer = CSILayer(stale_seconds=2)
        layer.update("edge", 0.6, now=1)
        self.assertEqual(layer.state_for("edge", now=4)["status"], "STALE")
        self.assertEqual(layer.update("new", "bad")["status"], "UNKNOWN")
