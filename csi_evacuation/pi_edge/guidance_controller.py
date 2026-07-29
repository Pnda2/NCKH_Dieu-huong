import json
import math
import time


ACK_TIMEOUT_SECONDS = 3.0
DEVICE_OFFLINE_SECONDS = 12.0
COMMAND_HEARTBEAT_SECONDS = 5.0
COMMAND_VALID_SECONDS = 8


class GuidanceController:
    """Convert graph routing decisions into sign/speaker MQTT commands."""

    def __init__(self):
        self.devices = []
        self.area_map = {}
        self.edge_map = {}
        self.sequence = 0
        self.last_commands = {}
        self.pending_acks = {}
        self.last_acks = {}
        self.offline_devices = set()
        self.latest_state = {"decisions": {}, "devices": []}

    def configure(self, map_config):
        self.devices = list(map_config.get("devices", []))
        self.area_map = {
            area["id"]: area for area in map_config.get("areas", [])
        }
        self.edge_map = {
            edge["id"]: edge for edge in map_config.get("edges", [])
        }
        valid_ids = {device.get("id") for device in self.devices}
        self.last_commands = {
            key: value
            for key, value in self.last_commands.items()
            if key in valid_ids
        }
        self.pending_acks = {
            key: value
            for key, value in self.pending_acks.items()
            if key in valid_ids
        }
        self.offline_devices.intersection_update(valid_ids)

    def _other_area(self, edge, area_id):
        if edge.get("areaA_id") == area_id:
            return self.area_map.get(edge.get("areaB_id"))
        if edge.get("areaB_id") == area_id:
            return self.area_map.get(edge.get("areaA_id"))
        return None

    def _infer_direction(self, device, target_edge):
        explicit = (device.get("edgeDirections") or {}).get(target_edge)
        if explicit:
            return explicit.upper()

        area_id = device.get("area_id")
        area = self.area_map.get(area_id)
        edge = self.edge_map.get(target_edge)
        other = self._other_area(edge, area_id) if edge else None
        if not area or not other:
            return "STRAIGHT"

        current_floor = area.get("floor", 1)
        other_floor = other.get("floor", 1)
        if other_floor > current_floor:
            return "UP"
        if other_floor < current_floor:
            return "DOWN"

        dx = float(other.get("x", 0)) - float(area.get("x", 0))
        dy = float(other.get("y", 0)) - float(area.get("y", 0))
        bearing = math.degrees(math.atan2(dx, -dy)) % 360
        orientation = float(device.get("orientation", 0)) % 360
        relative = ((bearing - orientation + 180) % 360) - 180
        if abs(relative) <= 30:
            return "STRAIGHT"
        if 30 < relative < 150:
            return "RIGHT"
        if -150 < relative < -30:
            return "LEFT"
        return "BACK"

    def _edge_width(self, edge_id):
        edge = self.edge_map.get(edge_id, {})
        try:
            return max(0.1, float(edge.get("widthMeters", 1.2)))
        except (TypeError, ValueError):
            return 1.2

    def _receiving_capacity(self, edge_id, occupancy):
        edge = self.edge_map.get(edge_id, {})
        width = self._edge_width(edge_id)
        area_a = self.area_map.get(edge.get("areaA_id"), {})
        area_b = self.area_map.get(edge.get("areaB_id"), {})
        is_stair_connection = (
            (
                area_a.get("type") == "stairs"
                and area_b.get("type") == "stairs"
            )
            or area_a.get("floor", 1) != area_b.get("floor", 1)
        )
        type_factor = 0.65 if is_stair_connection else 1.0
        return width * max(0.0, 1.0 - float(occupancy)) * type_factor

    @staticmethod
    def _speaker_command(direction):
        return {
            "LEFT": "EVACUATE_LEFT",
            "RIGHT": "EVACUATE_RIGHT",
            "STRAIGHT": "EVACUATE_STRAIGHT",
            "BACK": "TURN_BACK",
            "UP": "GO_UPSTAIRS",
            "DOWN": "GO_DOWNSTAIRS",
            "EXIT": "EXIT_HERE",
            "NO_SAFE_ROUTE": "SHELTER_IN_PLACE",
        }.get(direction, "EVACUATE_STRAIGHT")

    def handle_ack(self, payload):
        device_id = payload.get("device_id")
        sequence = payload.get("sequence")
        if not device_id:
            return
        now = time.time()
        self.last_acks[device_id] = {
            "sequence": sequence,
            "status": payload.get("status", "ok"),
            "received_at": now,
            "detail": payload.get("detail"),
        }
        self.offline_devices.discard(device_id)
        pending = self.pending_acks.get(device_id)
        if pending and pending.get("sequence") == sequence:
            self.pending_acks.pop(device_id, None)

    def _device_status(self, device_id, now):
        pending = self.pending_acks.get(device_id)
        last_ack = self.last_acks.get(device_id)
        if pending and now - pending["sent_at"] > ACK_TIMEOUT_SECONDS:
            self.offline_devices.add(device_id)
            return "offline"
        if device_id in self.offline_devices:
            return "offline"
        if pending:
            return "waiting_ack"
        if last_ack:
            if now - last_ack["received_at"] <= DEVICE_OFFLINE_SECONDS:
                return "online"
            return "offline"
        if device_id in self.last_commands:
            return "waiting_ack"
        return "idle"

    def _publish_command(self, client, device, decision, now, force=False):
        device_id = device.get("id")
        device_type = device.get("type", "sign")
        target_edge = decision.get("next_edge") if decision else None
        route_commands = []
        for route in (decision or {}).get("routes", []):
            route_edge = route.get("edge_id")
            route_commands.append(
                {
                    "target_edge": route_edge,
                    "direction": self._infer_direction(device, route_edge),
                    "probability": route.get("probability", 0),
                }
            )

        if decision and decision.get("at_exit"):
            direction = "EXIT"
        elif target_edge:
            direction = self._infer_direction(device, target_edge)
        else:
            direction = "NO_SAFE_ROUTE"

        command = (
            direction
            if device_type == "sign"
            else self._speaker_command(direction)
        )
        route_signature = tuple(
            (
                route.get("target_edge"),
                round(float(route.get("probability", 0)) * 20) / 20,
            )
            for route in route_commands
        )
        signature = (command, target_edge, route_signature)
        previous = self.last_commands.get(device_id)
        changed = not previous or previous.get("signature") != signature
        heartbeat_due = (
            previous
            and now - previous.get("sent_at", 0) >= COMMAND_HEARTBEAT_SECONDS
        )
        if not (force or changed or heartbeat_due):
            return previous.get("payload")

        self.sequence += 1
        payload = {
            "sequence": self.sequence,
            "device_id": device_id,
            "device_type": device_type,
            "area_id": device.get("area_id"),
            "command": command,
            "direction": direction,
            "target_edge": target_edge,
            "probability": round(decision.get("probability", 0), 3)
            if decision
            else 0,
            "routes": route_commands,
            "generated_at": int(now),
            "valid_until": int(now) + COMMAND_VALID_SECONDS,
            "priority": "emergency",
        }
        topic = device.get("topic") or (
            f"building/guidance/{device_type}/{device_id}"
        )
        client.publish(
            topic,
            json.dumps(payload, ensure_ascii=False),
            qos=1,
            retain=True,
        )
        self.last_commands[device_id] = {
            "signature": signature,
            "sent_at": now,
            "payload": payload,
        }
        self.pending_acks[device_id] = {
            "sequence": self.sequence,
            "sent_at": now,
        }
        return payload

    def update(
        self,
        client,
        route_options,
        distances,
        edge_occupancy,
        exits,
        blocked_edges,
        force=False,
    ):
        now = time.time()
        decisions = {}
        for area_id in self.area_map:
            if area_id in exits:
                decisions[area_id] = {
                    "at_exit": True,
                    "next_edge": None,
                    "probability": 1.0,
                    "distance": 0.0,
                    "routes": [],
                }
                continue
            options = [
                option
                for option in route_options.get(area_id, [])
                if option[1] not in blocked_edges
            ]
            if options:
                sorted_options = sorted(
                    options, key=lambda option: option[2], reverse=True
                )[:2]
                route_total = sum(option[2] for option in sorted_options)
                routes = [
                    {
                        "next_area": neighbour,
                        "edge_id": route_edge_id,
                        "probability": round(probability / route_total, 3),
                        "k": round(edge_occupancy.get(route_edge_id, 0.0), 3),
                        "widthMeters": self._edge_width(route_edge_id),
                        "receivingCapacity": round(
                            self._receiving_capacity(
                                route_edge_id,
                                edge_occupancy.get(route_edge_id, 0.0),
                            ),
                            3,
                        ),
                    }
                    for neighbour, route_edge_id, probability in sorted_options
                ]
                primary = routes[0]
                decisions[area_id] = {
                    "at_exit": False,
                    "next_edge": primary["edge_id"],
                    "probability": primary["probability"],
                    "distance": round(distances.get(area_id, 0.0), 2),
                    "k": primary["k"],
                    "routes": routes,
                }
            else:
                decisions[area_id] = {
                    "at_exit": False,
                    "next_edge": None,
                    "probability": 0.0,
                    "distance": None,
                    "routes": [],
                }

        device_states = []
        for device in self.devices:
            device_id = device.get("id")
            decision = decisions.get(device.get("area_id"))
            command_payload = self._publish_command(
                client, device, decision, now, force=force
            )
            device_states.append(
                {
                    "id": device_id,
                    "name": device.get("name", device_id),
                    "type": device.get("type", "sign"),
                    "area_id": device.get("area_id"),
                    "status": self._device_status(device_id, now),
                    "last_command": command_payload,
                    "last_ack": self.last_acks.get(device_id),
                }
            )

        self.latest_state = {
            "generated_at": int(now),
            "decisions": decisions,
            "devices": device_states,
        }
        client.publish(
            "building/guidance/state",
            json.dumps(self.latest_state, ensure_ascii=False),
            qos=1,
            retain=True,
        )
        return self.latest_state

    def stop_all(self, client):
        """Put every configured device into a safe standby state."""
        now = time.time()
        for device in self.devices:
            self.sequence += 1
            device_id = device.get("id")
            device_type = device.get("type", "sign")
            payload = {
                "sequence": self.sequence,
                "device_id": device_id,
                "device_type": device_type,
                "area_id": device.get("area_id"),
                "command": "STANDBY",
                "direction": "STANDBY",
                "target_edge": None,
                "routes": [],
                "generated_at": int(now),
                "valid_until": int(now) + COMMAND_VALID_SECONDS,
                "priority": "control",
            }
            topic = device.get("topic") or (
                f"building/guidance/{device_type}/{device_id}"
            )
            client.publish(
                topic,
                json.dumps(payload, ensure_ascii=False),
                qos=1,
                retain=True,
            )
            self.last_commands[device_id] = {
                "signature": ("STANDBY", None),
                "sent_at": now,
                "payload": payload,
            }
            self.pending_acks[device_id] = {
                "sequence": self.sequence,
                "sent_at": now,
            }
        self.latest_state = {
            "generated_at": int(now),
            "decisions": {},
            "devices": [
                {
                    "id": device.get("id"),
                    "name": device.get("name", device.get("id")),
                    "type": device.get("type", "sign"),
                    "area_id": device.get("area_id"),
                    "status": self._device_status(device.get("id"), now),
                    "last_command": self.last_commands.get(
                        device.get("id"), {}
                    ).get("payload"),
                }
                for device in self.devices
            ],
        }
        client.publish(
            "building/guidance/state",
            json.dumps(self.latest_state, ensure_ascii=False),
            qos=1,
            retain=True,
        )
