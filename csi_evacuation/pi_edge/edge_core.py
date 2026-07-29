import heapq
import json
import math
import os
import random
import threading
import time

import paho.mqtt.client as mqtt

from csi_layer import CSILayer
from dynamic_routing import DynamicEvacuationRouter, WeightParameters, corridor_capacity, dynamic_edge_cost
from guidance_controller import GuidanceController


MQTT_BROKER = os.getenv("WIEVAC_MQTT_HOST", "127.0.0.1")
MQTT_PORT = int(os.getenv("WIEVAC_MQTT_PORT", "1883"))
CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

# k(e) is the normalized CSI-derived occupancy of corridor e:
# 0.0 = empty corridor, 1.0 = fully occupied corridor.
TICK_SECONDS = 1.0
FREE_WALKING_SPEED = 1.2
DEFAULT_INITIAL_OCCUPANCY = (0.20, 0.75)
BASE_TRANSFER_RATE = 0.025  # equivalent corridor occupancy moved per second
GAMMA = max(0.0, float(os.getenv("WIEVAC_GAMMA", "1.0")))
DELTA = max(1.0, float(os.getenv("WIEVAC_DELTA", "2.0")))
ROUTE_CHANGE_PENALTY = 5.0
LOGIT_THETA = 0.35
OCCUPANCY_EPSILON = 0.005
DEFAULT_CORRIDOR_WIDTH_METERS = 1.2
CAPACITY_BETA = 1.0
STAIR_CAPACITY_FACTOR = 0.65
MAX_GUIDANCE_ROUTES = 2
MIN_SECONDARY_ROUTE_SHARE = 0.10
MIN_RECEIVING_SCORE = 0.01

map_config = {"areas": [], "edges": []}
routing_parameters = WeightParameters(
    free_walking_speed=float(os.getenv("WIEVAC_FREE_WALKING_SPEED", str(FREE_WALKING_SPEED))),
    gamma=GAMMA,
    delta=DELTA,
    hazard_block_threshold=float(os.getenv("WIEVAC_HAZARD_BLOCK_THRESHOLD", "100")),
    people_per_square_meter=float(os.getenv("WIEVAC_PEOPLE_PER_SQM", "2.0")),
).validated()
routing_service = None
simulation_active = False
simulation_thread = None
shutting_down = False
blocked_edges = set()
blocked_exits = set()
edge_hazards = {}

state_lock = threading.RLock()
edge_occupancy = {}
previous_next_edge = {}
pending_occupancy_updates = []
latest_sensor_occupancy = {}
simulation_started_at = None
elapsed_before_pause = 0
simulation_step = 0
evacuated_load = 0.0
initial_total_load = 0.0
guidance_controller = GuidanceController()


def clamp_occupancy(value):
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.0


def load_config():
    global map_config, routing_service
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as file:
            map_config = json.load(file)
            routing_service = DynamicEvacuationRouter(map_config, routing_parameters)
            guidance_controller.configure(map_config)
            print("Loaded config from file.")
    except Exception as exc:
        print("Could not load config file, starting empty:", exc)
        map_config = {"areas": [], "edges": []}


def save_config(data):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as file:
            json.dump(data, file, indent=2, ensure_ascii=False)
        print("Saved new config to file.")
    except Exception as exc:
        print("Error saving config:", exc)


def calculate_dynamic_weight(edge, k, switching=False):
    """Safe required weight: t0 * [1 + gamma * (c/Cmax)^delta] + H."""
    capacity = corridor_capacity(edge, routing_parameters)
    return dynamic_edge_cost(
        edge,
        current_people=clamp_occupancy(k) * capacity,
        hazard=edge_hazards.get(edge.get("id"), edge.get("hazard", 0.0)),
        blocked=edge.get("id") in blocked_edges,
        parameters=routing_parameters,
    )


def calculate_receiving_capacity(edge, k):
    """Relative ability of an edge to receive more evacuees.

    CSI supplies normalized occupancy k(e), while physical width supplies the
    missing absolute scale. This is intentionally a relative capacity until
    field measurements provide a calibrated people/second coefficient.
    """
    try:
        width = float(edge.get("widthMeters", DEFAULT_CORRIDOR_WIDTH_METERS))
    except (TypeError, ValueError):
        width = DEFAULT_CORRIDOR_WIDTH_METERS
    width = max(0.1, width)
    openness = max(0.0, 1.0 - clamp_occupancy(k)) ** CAPACITY_BETA

    area_map = {
        area["id"]: area for area in map_config.get("areas", [])
    }
    area_a = area_map.get(edge.get("areaA_id"), {})
    area_b = area_map.get(edge.get("areaB_id"), {})
    is_stair_connection = (
        (
            area_a.get("type") == "stairs"
            and area_b.get("type") == "stairs"
        )
        or area_a.get("floor", 1) != area_b.get("floor", 1)
    )
    type_factor = STAIR_CAPACITY_FACTOR if is_stair_connection else 1.0
    return max(MIN_RECEIVING_SCORE, width * openness * type_factor)


def build_graph():
    areas = map_config.get("areas", [])
    edges = map_config.get("edges", [])
    graph = {area["id"]: [] for area in areas}
    edge_map = {edge["id"]: edge for edge in edges}
    for edge in edges:
        edge_id = edge.get("id")
        if edge_id in blocked_edges:
            continue
        area_a = edge.get("areaA_id")
        area_b = edge.get("areaB_id")
        if area_a in graph and area_b in graph:
            graph[area_a].append((area_b, edge_id))
            graph[area_b].append((area_a, edge_id))
    return graph, edge_map


def compute_routes(graph, edge_map, occupancy):
    """Use persistent D* Lite states and only repair changed corridor costs."""
    global routing_service
    if routing_service is None:
        routing_service = DynamicEvacuationRouter(map_config, routing_parameters)
    routing_service.update(occupancy, edge_hazards, blocked_edges, blocked_exits)
    exits = {
        area["id"] for area in map_config.get("areas", [])
        if area.get("type") == "exit" and area["id"] not in blocked_exits
    }
    distances = {}
    route_options = {}
    for area_id, route in routing_service.routes_for_all_areas().items():
        distances[area_id] = route["cost"]
        edge_id = route["next_edge"]
        if not edge_id:
            continue
        edge = edge_map[edge_id]
        neighbour = edge["areaB_id"] if edge["areaA_id"] == area_id else edge["areaA_id"]
        route_options[area_id] = [(neighbour, edge_id, 1.0)]
    return exits, distances, route_options


def make_log(event_type, message):
    return {
        "type": event_type,
        "message": message,
        "time": time.strftime("%H:%M:%S"),
    }


def publish_log(client, events, step=None):
    if events:
        client.publish(
            "building/log",
            json.dumps({"step": step, "events": events}, ensure_ascii=False),
        )


def queue_occupancy_update(edge_id, value, mode="set"):
    with state_lock:
        pending_occupancy_updates.append(
            {"edge_id": edge_id, "value": float(value), "mode": mode}
        )


def apply_pending_occupancy_updates(client, edge_map):
    global initial_total_load
    events = []
    with state_lock:
        updates = list(pending_occupancy_updates)
        pending_occupancy_updates.clear()
        for update in updates:
            edge_id = update.get("edge_id")
            if edge_id not in edge_occupancy:
                continue
            old_k = edge_occupancy[edge_id]
            if update.get("mode") == "delta":
                new_k = clamp_occupancy(old_k + update.get("value", 0.0))
            else:
                new_k = clamp_occupancy(update.get("value", old_k))
            edge_occupancy[edge_id] = new_k
            initial_total_load = max(
                evacuated_load + sum(edge_occupancy.values()),
                initial_total_load + (new_k - old_k),
            )
            events.append(
                make_log(
                    "adjustment",
                    f"{edge_map.get(edge_id, {}).get('name', edge_id)}: k(e) thay đổi từ {old_k * 100:.0f}% thành {new_k * 100:.0f}%.",
                )
            )
    publish_log(client, events)


def publish_state(client, status, step, trapped_ids=None, message=None):
    edge_map = {edge["id"]: edge for edge in map_config.get("edges", [])}
    trapped_ids = trapped_ids or []
    with state_lock:
        values = list(edge_occupancy.values())
        elapsed = elapsed_before_pause + (
            max(0, int(time.time() - simulation_started_at))
            if simulation_started_at
            else 0
        )
        metrics = (
            routing_service.edge_metrics(edge_occupancy, edge_hazards)
            if routing_service
            else {}
        )
        payload = {
            "status": status,
            "step": step,
            "elapsedSeconds": elapsed,
            "initialLoad": round(initial_total_load, 3),
            "evacuatedLoad": round(evacuated_load, 3),
            "remainingLoad": round(sum(values), 3),
            "trappedLoad": round(
                sum(edge_occupancy.get(edge_id, 0.0) for edge_id in trapped_ids), 3
            ),
            "averageOccupancy": round(sum(values) / len(values), 3) if values else 0.0,
            "occupiedCorridors": sum(value > OCCUPANCY_EPSILON for value in values),
            "estimatedPeople": round(sum(item["currentPeople"] for item in metrics.values()), 1),
            "availableExits": sum(
                1 for area in map_config.get("areas", [])
                if area.get("type") == "exit" and area.get("id") not in blocked_exits
            ),
            "hazardousCorridors": sum(
                1 for item in metrics.values()
                if item.get("hazard", 0) > 0 or item.get("blocked")
            ),
            "edgeMetrics": metrics,
            "routingAlgorithm": "D* Lite",
            "lastUpdated": int(time.time()),
            "trappedCorridors": [
                {
                    "id": edge_id,
                    "name": edge_map.get(edge_id, {}).get("name", edge_id),
                    "k": round(edge_occupancy.get(edge_id, 0.0), 3),
                }
                for edge_id in trapped_ids
            ],
            "edgeOccupancy": {
                edge_id: round(value, 3)
                for edge_id, value in edge_occupancy.items()
            },
        }
        if message:
            payload["message"] = message
    client.publish("building/simulation/state", json.dumps(payload, ensure_ascii=False))


def initialize_simulation():
    global edge_occupancy, previous_next_edge
    global simulation_started_at, elapsed_before_pause, simulation_step
    global evacuated_load, initial_total_load

    edge_occupancy = {}
    for edge in map_config.get("edges", []):
        edge_id = edge["id"]
        if edge_id in latest_sensor_occupancy:
            value = latest_sensor_occupancy[edge_id]
        elif edge.get("initialOccupancy") is not None:
            value = edge.get("initialOccupancy")
        else:
            value = random.uniform(*DEFAULT_INITIAL_OCCUPANCY)
        edge_occupancy[edge_id] = clamp_occupancy(value)

    previous_next_edge = {}
    evacuated_load = 0.0
    initial_total_load = sum(edge_occupancy.values())
    simulation_started_at = time.time()
    elapsed_before_pause = 0
    simulation_step = 0


def select_egress_options(edge, exits, distances, route_options):
    """Return both usable endpoints and their probabilities.

    This is especially important after an incident: no new load may enter the
    blocked corridor, but load already present can still retreat to either end.
    """
    endpoints = (edge.get("areaA_id"), edge.get("areaB_id"))
    candidates = []
    for endpoint in endpoints:
        if endpoint in exits:
            candidates.append((endpoint, [], distances.get(endpoint, 0.0)))
            continue
        choices = [
            option
            for option in route_options.get(endpoint, [])
            if option[1] != edge.get("id")
        ]
        if choices and math.isfinite(distances.get(endpoint, math.inf)):
            candidates.append((endpoint, choices, distances[endpoint]))
    if not candidates:
        return []

    minimum = min(candidate[2] for candidate in candidates)
    scores = [
        math.exp(-LOGIT_THETA * (candidate[2] - minimum))
        for candidate in candidates
    ]
    total_score = sum(scores)
    return [
        (candidate[0], candidate[1], score / total_score)
        for candidate, score in zip(candidates, scores)
    ]


def simulation_loop(client, resume=False):
    global simulation_active, evacuated_load, simulation_started_at, simulation_step
    areas = map_config.get("areas", [])
    edges = map_config.get("edges", [])
    edge_map_all = {edge["id"]: edge for edge in edges}

    if not areas or not edges:
        simulation_active = False
        publish_state(client, "error", 0, message="Bản đồ đang trống.")
        return
    if not any(area.get("type") == "exit" for area in areas):
        simulation_active = False
        publish_state(client, "error", 0, message="Bản đồ không có lối thoát.")
        return

    if resume and edge_occupancy:
        simulation_started_at = time.time()
    else:
        initialize_simulation()
    csi = CSILayer(noise_level=0.03)
    step = simulation_step
    last_trapped_ids = set()
    action = "Resumed" if resume else "Started"
    print(f"[SIM] {action} with equivalent corridor load {sum(edge_occupancy.values()):.2f}.")
    publish_state(client, "running", step)

    while simulation_active and not shutting_down:
        tick_started = time.monotonic()
        step += 1
        simulation_step = step
        events = []
        apply_pending_occupancy_updates(client, edge_map_all)

        with state_lock:
            graph, edge_map = build_graph()
            exits, distances, route_options = compute_routes(
                graph, edge_map, edge_occupancy
            )

            trapped_ids = set()
            movement_plan = {}
            for edge_id, k in edge_occupancy.items():
                if k <= OCCUPANCY_EPSILON:
                    continue
                edge = edge_map_all[edge_id]
                egress_options = select_egress_options(
                    edge, exits, distances, route_options
                )
                if not egress_options:
                    trapped_ids.add(edge_id)
                else:
                    movement_plan[edge_id] = egress_options

            for edge_id in trapped_ids - last_trapped_ids:
                events.append(
                    make_log(
                        "trapped",
                        f"CẢNH BÁO: hành lang '{edge_map_all[edge_id].get('name', edge_id)}' có k={edge_occupancy[edge_id] * 100:.0f}% nhưng không còn tuyến tới lối thoát.",
                    )
                )
            for edge_id in last_trapped_ids - trapped_ids:
                events.append(
                    make_log(
                        "routing",
                        f"Đã khôi phục tuyến thoát cho hành lang '{edge_map_all[edge_id].get('name', edge_id)}'.",
                    )
                )
            last_trapped_ids = set(trapped_ids)

            old_occupancy = dict(edge_occupancy)
            next_occupancy = dict(edge_occupancy)
            reserved_incoming = {edge_id: 0.0 for edge_id in edge_occupancy}

            for edge_id, egress_options in movement_plan.items():
                source_k = old_occupancy[edge_id]
                total_budget = min(
                    source_k, BASE_TRANSFER_RATE * TICK_SECONDS
                )
                if total_budget <= OCCUPANCY_EPSILON:
                    continue

                moved = 0.0
                for endpoint, choices, endpoint_probability in egress_options:
                    endpoint_budget = total_budget * endpoint_probability
                    if endpoint in exits:
                        evacuated_load += endpoint_budget
                        moved += endpoint_budget
                        continue

                    valid_choices = [
                        option
                        for option in choices
                        if option[1] not in blocked_edges
                    ]
                    probability_sum = sum(
                        option[2] for option in valid_choices
                    )
                    if probability_sum <= 0:
                        continue

                    for _, next_edge_id, probability in valid_choices:
                        next_k = (
                            old_occupancy.get(next_edge_id, 0.0)
                            + reserved_incoming[next_edge_id]
                        )
                        available = max(0.0, 1.0 - next_k)
                        acceptance = max(0.1, (1.0 - next_k) ** 1.5)
                        requested = (
                            endpoint_budget * probability / probability_sum
                        )
                        transfer = min(requested * acceptance, available)
                        if transfer <= OCCUPANCY_EPSILON:
                            continue
                        next_occupancy[next_edge_id] += transfer
                        reserved_incoming[next_edge_id] += transfer
                        moved += transfer

                    if valid_choices:
                        previous_next_edge[endpoint] = max(
                            valid_choices, key=lambda option: option[2]
                        )[1]

                next_occupancy[edge_id] = max(
                    0.0, next_occupancy[edge_id] - moved
                )

            edge_occupancy.update(
                {
                    edge_id: clamp_occupancy(value)
                    for edge_id, value in next_occupancy.items()
                }
            )
            theoretical_occupancy = dict(edge_occupancy)

        guidance_controller.update(
            client,
            route_options,
            distances,
            theoretical_occupancy,
            exits,
            blocked_edges,
        )
        sensed_occupancy = csi.process_edge_data(theoretical_occupancy)
        sensed_occupancy = {
            edge_id: round(value, 3)
            for edge_id, value in sensed_occupancy.items()
        }
        if not simulation_active:
            break
        client.publish(
            "building/occupancy", json.dumps(sensed_occupancy, ensure_ascii=False)
        )
        publish_log(client, events, step)
        publish_state(client, "running", step, sorted(last_trapped_ids))

        with state_lock:
            reachable_load = sum(
                k
                for edge_id, k in edge_occupancy.items()
                if edge_id not in last_trapped_ids
            )
            trapped_load = sum(
                edge_occupancy.get(edge_id, 0.0)
                for edge_id in last_trapped_ids
            )

        if reachable_load <= OCCUPANCY_EPSILON:
            simulation_active = False
            if trapped_load > OCCUPANCY_EPSILON:
                message = "Mô phỏng dừng: còn hành lang có độ lấp đầy nhưng không còn tuyến tới lối thoát."
                publish_log(client, [make_log("trapped", message)], step)
                publish_state(
                    client, "trapped", step, sorted(last_trapped_ids), message
                )
            else:
                message = "Sơ tán hoàn tất: độ lấp đầy các hành lang đã về 0%."
                with state_lock:
                    for edge_id, k in edge_occupancy.items():
                        if k <= OCCUPANCY_EPSILON:
                            edge_occupancy[edge_id] = 0.0
                publish_log(client, [make_log("complete", message)], step)
                guidance_controller.stop_all(client)
                publish_state(client, "completed", step, message=message)
                client.publish(
                    "building/occupancy",
                    json.dumps({edge["id"]: 0.0 for edge in edges}),
                )
            break

        sleep_for = TICK_SECONDS - (time.monotonic() - tick_started)
        if sleep_for > 0:
            time.sleep(sleep_for)


def stop_simulation(client):
    global simulation_active, simulation_thread
    global simulation_started_at, elapsed_before_pause
    was_running = simulation_active
    with state_lock:
        simulation_active = False
        if simulation_started_at is not None:
            elapsed_before_pause += max(
                0, int(time.time() - simulation_started_at)
            )
            simulation_started_at = None
    if (
        simulation_thread
        and simulation_thread.is_alive()
        and simulation_thread is not threading.current_thread()
    ):
        simulation_thread.join(timeout=TICK_SECONDS + 1.0)
    if was_running:
        publish_log(
            client,
            [make_log("stopped", "Mô phỏng đã được dừng bởi người vận hành.")],
        )
    guidance_controller.stop_all(client)
    publish_state(
        client, "stopped", simulation_step, message="Mô phỏng đã dừng."
    )


def reset_simulation(client):
    global simulation_active, simulation_thread
    global edge_occupancy, previous_next_edge, pending_occupancy_updates
    global latest_sensor_occupancy, simulation_started_at
    global elapsed_before_pause, simulation_step, evacuated_load, initial_total_load

    simulation_active = False
    if (
        simulation_thread
        and simulation_thread.is_alive()
        and simulation_thread is not threading.current_thread()
    ):
        simulation_thread.join(timeout=2.0)

    with state_lock:
        edge_occupancy = {
            edge["id"]: 0.0 for edge in map_config.get("edges", [])
        }
        previous_next_edge = {}
        pending_occupancy_updates = []
        latest_sensor_occupancy = {}
        simulation_started_at = None
        elapsed_before_pause = 0
        simulation_step = 0
        evacuated_load = 0.0
        initial_total_load = 0.0

    guidance_controller.stop_all(client)
    client.publish(
        "building/occupancy",
        json.dumps(edge_occupancy, ensure_ascii=False),
    )
    publish_log(
        client,
        [make_log("reset", "Mô phỏng đã reset, sẵn sàng cho lượt chạy mới.")],
    )
    publish_state(
        client,
        "idle",
        0,
        message="Đã reset. Nhấn Chạy mô phỏng để bắt đầu lượt mới.",
    )


def publish_live_guidance(client):
    """Recompute device commands directly from the latest real CSI values."""
    if not map_config.get("areas") or not map_config.get("edges"):
        return
    occupancy = {
        edge["id"]: latest_sensor_occupancy.get(edge["id"], 0.0)
        for edge in map_config.get("edges", [])
    }
    graph, edge_map = build_graph()
    exits, distances, route_options = compute_routes(
        graph, edge_map, occupancy
    )
    guidance_controller.update(
        client,
        route_options,
        distances,
        occupancy,
        exits,
        blocked_edges,
    )


def on_connect(client, userdata, flags, reason_code, properties=None):
    if shutting_down:
        return
    if reason_code == 0:
        print("Connected to MQTT Broker!")
        client.subscribe("building/config")
        client.subscribe("building/simulation/start")
        client.subscribe("building/simulation/resume")
        client.subscribe("building/simulation/stop")
        client.subscribe("building/simulation/reset")
        client.subscribe("building/occupancy/adjust")
        client.subscribe("building/occupancy/input")
        client.subscribe("building/hazard/adjust")
        client.subscribe("building/incident")
        client.subscribe("building/incident/clear")
        client.subscribe("building/guidance/ack/+")
    else:
        print(f"Failed to connect, return code {reason_code}")


def on_message(client, userdata, msg):
    global map_config, simulation_active, simulation_thread, routing_service
    topic = msg.topic
    if topic == "building/config":
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            map_config = data
            routing_service = DynamicEvacuationRouter(map_config, routing_parameters)
            guidance_controller.configure(map_config)
            save_config(data)
        except Exception as exc:
            print("Error parsing map config:", exc)

    elif topic == "building/simulation/start":
        if simulation_thread and simulation_thread.is_alive():
            simulation_active = False
            simulation_thread.join(timeout=2.0)
        simulation_active = True
        simulation_thread = threading.Thread(
            target=simulation_loop, args=(client, False), daemon=True
        )
        simulation_thread.start()

    elif topic == "building/simulation/resume":
        if simulation_thread and simulation_thread.is_alive():
            simulation_active = False
            simulation_thread.join(timeout=2.0)
        simulation_active = True
        simulation_thread = threading.Thread(
            target=simulation_loop, args=(client, True), daemon=True
        )
        simulation_thread.start()

    elif topic == "building/simulation/stop":
        stop_simulation(client)

    elif topic == "building/simulation/reset":
        reset_simulation(client)

    elif topic == "building/occupancy/input":
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            values = data.get("values")
            if values is None:
                values = {data.get("edge_id"): data.get("k")}
            clean_values = {
                edge_id: clamp_occupancy(k)
                for edge_id, k in values.items()
                if edge_id and k is not None
            }
            with state_lock:
                latest_sensor_occupancy.update(clean_values)
            if simulation_active:
                for edge_id, k in clean_values.items():
                    queue_occupancy_update(edge_id, k, "set")
            client.publish(
                "building/occupancy",
                json.dumps(clean_values, ensure_ascii=False),
            )
            client.publish(
                "building/occupancy/adjust_ack",
                json.dumps({"success": True, "source": "sensor"}),
            )
            if not simulation_active:
                publish_live_guidance(client)
        except Exception as exc:
            client.publish(
                "building/occupancy/adjust_ack",
                json.dumps({"success": False, "error": str(exc)}),
            )

    elif topic == "building/occupancy/adjust":
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            if not simulation_active:
                raise ValueError("simulation_not_running")
            if "values" in data:
                for edge_id, k in data["values"].items():
                    queue_occupancy_update(edge_id, k, "set")
            else:
                edge_id = data.get("edge_id")
                if edge_id not in edge_occupancy:
                    raise ValueError("edge_not_found")
                queue_occupancy_update(
                    edge_id, data.get("delta", 0.0), "delta"
                )
            client.publish(
                "building/occupancy/adjust_ack",
                json.dumps({"success": True}),
            )
        except Exception as exc:
            client.publish(
                "building/occupancy/adjust_ack",
                json.dumps({"success": False, "error": str(exc)}),
            )

    elif topic == "building/hazard/adjust":
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            edge_id = data.get("edge_id")
            hazard = max(0.0, float(data.get("hazard", 0.0)))
            known_edges = {edge.get("id") for edge in map_config.get("edges", [])}
            if edge_id not in known_edges:
                raise ValueError("edge_not_found")
            edge_hazards[edge_id] = hazard
            publish_log(
                client,
                [make_log("alert" if hazard else "routing", f"Nguy cơ tại {edge_id}: {hazard:.0f}")],
            )
            if not simulation_active:
                publish_live_guidance(client)
        except Exception as exc:
            publish_log(client, [make_log("alert", f"Dữ liệu nguy cơ không hợp lệ: {exc}")])

    elif topic in ("building/incident", "building/incident/clear"):
        try:
            data = json.loads(msg.payload.decode("utf-8"))
            target_id = data.get("target_id")
            incident_type = data.get("type")
            is_clear = topic.endswith("/clear")
            target_set = (
                blocked_edges if incident_type == "edge" else blocked_exits
            )
            if is_clear:
                target_set.discard(target_id)
                action = "cleared"
            else:
                target_set.add(target_id)
                action = "blocked"
            client.publish(
                "building/incident_ack",
                json.dumps(
                    {
                        "action": action,
                        "type": incident_type,
                        "target_id": target_id,
                    }
                ),
            )
            if incident_type == "edge":
                edge_name = next(
                    (
                        edge.get("name", target_id)
                        for edge in map_config.get("edges", [])
                        if edge.get("id") == target_id
                    ),
                    target_id,
                )
                message = (
                    f"Đã mở lại hành lang '{edge_name}'. Hệ thống tiếp tục từ k(e) hiện tại, không khôi phục giá trị trước sự cố."
                    if is_clear
                    else f"Hành lang '{edge_name}' bị chặn hoặc mất tín hiệu. Không nhận tải mới; tải hiện có sẽ được ước lượng thoát qua hai đầu hành lang."
                )
                publish_log(
                    client,
                    [make_log("routing" if is_clear else "alert", message)],
                )
            if not simulation_active:
                publish_live_guidance(client)
        except Exception as exc:
            print("Error parsing incident:", exc)

    elif topic.startswith("building/guidance/ack/"):
        try:
            guidance_controller.handle_ack(
                json.loads(msg.payload.decode("utf-8"))
            )
            if not simulation_active:
                publish_live_guidance(client)
        except Exception as exc:
            print("Error parsing guidance ACK:", exc)


if __name__ == "__main__":
    load_config()
    client = mqtt.Client(
        mqtt.CallbackAPIVersion.VERSION2, client_id="Pi5_Edge_Node"
    )
    client.on_connect = on_connect
    client.on_message = on_message
    client.reconnect_delay_set(min_delay=1, max_delay=10)
    print(f"Connecting to MQTT Broker at {MQTT_BROKER}:{MQTT_PORT}...")
    try:
        client.connect(MQTT_BROKER, MQTT_PORT, 60)
    except Exception as exc:
        print("Connection failed, starting in offline mode:", exc)
    client.loop_start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        shutting_down = True
        simulation_active = False
        client.loop_stop()
        client.disconnect()
