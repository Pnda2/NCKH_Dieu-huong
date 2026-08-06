const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Aedes } = require("aedes");
const net = require("net");
const { normalizeMapData, hasInvalid3DValues, validateMapData } = require("./mapSchema");

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const MAP_FILE = path.join(__dirname, "map_data.json");
const HTTP_PORT = Number(process.env.WIEVAC_HTTP_PORT || 3001);
const MQTT_PORT = Number(process.env.WIEVAC_MQTT_PORT || 1883);
let simulationRunning = false;

/* function normalizeMapData(mapData) {
  const areas = Array.isArray(mapData?.areas)
    ? mapData.areas.map((area) => {
        const visual = area?.visual3d || {};
        const defaults = AREA_3D_DEFAULTS[area?.type] || AREA_3D_DEFAULTS.room;
        const positive = (value, fallback) => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
        const rotation = Number.isFinite(Number(visual.rotationDegrees)) ? Number(visual.rotationDegrees) : 0;
        const sizeMode = visual.sizeMode === "manual" ? "manual" : "auto";
        return {
          ...area,
          visual3d: {
            widthMeters: positive(visual.widthMeters, defaults.widthMeters),
            depthMeters: positive(visual.depthMeters, defaults.depthMeters),
            heightMeters: positive(visual.heightMeters, defaults.heightMeters),
            rotationDegrees: rotation,
            sizeMode,
            color: typeof visual.color === "string" && /^#[0-9a-fA-F]{6}$/.test(visual.color)
              ? visual.color : (AREA_3D_COLORS[area?.type] || AREA_3D_COLORS.room),
          },
        };
      })
    : [];
  const edges = Array.isArray(mapData?.edges)
    ? mapData.edges.map((edge) => {
        const width = Number(edge.widthMeters);
        const hasValidWidth = Number.isFinite(width) && width > 0;
        const length = Math.max(0, Number(edge.length) || 0);
        const explicitCapacity = Number(edge.capacityPeople);
        const capacityPeople = Number.isFinite(explicitCapacity)
          ? explicitCapacity
          : length * (hasValidWidth ? width : DEFAULT_CORRIDOR_WIDTH_METERS) * DEFAULT_PEOPLE_PER_SQM;
        const explicitFlow = Number(edge.flowCapacity);
        const flowCapacity = Number.isFinite(explicitFlow) && explicitFlow > 0
          ? explicitFlow : (hasValidWidth ? width : DEFAULT_CORRIDOR_WIDTH_METERS) * Number(process.env.WIEVAC_SPECIFIC_FLOW_PER_METER || 1.3);
        const hazard = Math.max(0, Number(edge.hazard) || 0);
        return {
          ...edge,
          widthMeters: hasValidWidth ? width : DEFAULT_CORRIDOR_WIDTH_METERS,
          widthEstimated: hasValidWidth ? Boolean(edge.widthEstimated) : true,
          capacityPeople,
          flowCapacity,
          initialOccupancy: Math.max(0, Math.min(1, Number(edge.initialOccupancy ?? 0.35))),
          hazard,
        };
      })
    : [];
  const rawScene = mapData?.scene3d || {};
  const positiveScene = (key) => Number.isFinite(Number(rawScene[key])) && Number(rawScene[key]) > 0
    ? Number(rawScene[key]) : DEFAULT_SCENE_3D[key];
  return {
    ...mapData,
    schemaVersion: 2,
    scene3d: {
      planUnitsPerMeter: positiveScene("planUnitsPerMeter"),
      floorHeightMeters: positiveScene("floorHeightMeters"),
      floorExplodeMeters: Number.isFinite(Number(rawScene.floorExplodeMeters)) && Number(rawScene.floorExplodeMeters) >= 0
        ? Number(rawScene.floorExplodeMeters) : DEFAULT_SCENE_3D.floorExplodeMeters,
      gridSizeMeters: positiveScene("gridSizeMeters"),
    },
    areas,
    edges,
  };
}

function hasInvalid3DValues(mapData) {
  const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;
  const scene = mapData?.scene3d;
  if (scene) {
    for (const field of ["planUnitsPerMeter", "floorHeightMeters", "gridSizeMeters"]) {
      if (scene[field] !== undefined && !positive(scene[field])) return `scene3d.${field} must be greater than 0`;
    }
    if (scene.floorExplodeMeters !== undefined && (!Number.isFinite(Number(scene.floorExplodeMeters)) || Number(scene.floorExplodeMeters) < 0)) {
      return "scene3d.floorExplodeMeters must be non-negative";
    }
  }
  for (const area of mapData?.areas || []) {
    const visual = area?.visual3d;
    if (!visual) continue;
    for (const field of ["widthMeters", "depthMeters", "heightMeters"]) {
      if (visual[field] !== undefined && !positive(visual[field])) return `Area ${area.id} visual3d.${field} must be greater than 0`;
    }
    if (visual.rotationDegrees !== undefined && !Number.isFinite(Number(visual.rotationDegrees))) return `Area ${area.id} visual3d.rotationDegrees must be finite`;
    if (visual.sizeMode !== undefined && visual.sizeMode !== "auto" && visual.sizeMode !== "manual") return `Area ${area.id} visual3d.sizeMode must be auto or manual`;
    if (visual.color !== undefined && (typeof visual.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(visual.color))) return `Area ${area.id} visual3d.color must be a hex color`;
  }
  return null;
}

function validateMapDataOld(mapData) {
  if (!Array.isArray(mapData?.areas) || !Array.isArray(mapData?.edges)) return "Map must include areas and edges arrays";
  const areaIds = new Set();
  for (const area of mapData.areas) {
    if (!area?.id || areaIds.has(area.id)) return "Area IDs must be unique";
    areaIds.add(area.id);
  }
  const edgeIds = new Set();
  for (const edge of mapData.edges) {
    if (!edge?.id || edgeIds.has(edge.id)) return "Edge IDs must be unique";
    edgeIds.add(edge.id);
    if (!areaIds.has(edge.areaA_id) || !areaIds.has(edge.areaB_id)) return `Edge ${edge.id} references an unknown area`;
    if (edge.areaA_id === edge.areaB_id) return `Edge ${edge.id} cannot be a self-loop`;
    if (!(Number(edge.length) > 0) || !(Number(edge.widthMeters) > 0)) return `Edge ${edge.id} needs length and widthMeters greater than 0`;
    if (edge.capacityPeople !== undefined && edge.capacityPeople !== '' && !(Number(edge.capacityPeople) > 0)) return `Edge ${edge.id} capacityPeople must be greater than 0`;
    if (edge.flowCapacity !== undefined && edge.flowCapacity !== '' && !(Number(edge.flowCapacity) > 0)) return `Edge ${edge.id} flowCapacity must be greater than 0`;
    if (edge.initialOccupancy !== undefined && (Number(edge.initialOccupancy) < 0 || Number(edge.initialOccupancy) > 1)) return `Edge ${edge.id} initialOccupancy must be between 0 and 1`;
  }
  for (const device of mapData.devices || []) if (!device?.id || !areaIds.has(device.area_id)) return "Every device must have an ID and reference an existing area";
  return null;
} */

// Ensure map file exists
if (!fs.existsSync(MAP_FILE)) {
  fs.writeFileSync(
    MAP_FILE,
    JSON.stringify({ areas: [], edges: [], floors: [1] }, null, 2)
  );
}

// ─── Start everything after Aedes broker is ready ───
async function startServer() {
  // Create and initialize the Aedes broker properly (async)
  const aedes = await Aedes.createBroker();

  // REST APIs for Map
  app.get("/api/map", (req, res) => {
    fs.readFile(MAP_FILE, "utf8", (err, data) => {
      if (err) return res.status(500).json({ error: "Failed to read map" });
      res.json(normalizeMapData(JSON.parse(data)));
    });
  });

  app.post("/api/map", (req, res) => {
    if (simulationRunning) return res.status(409).json({ error: "Stop or reset the simulation before changing map topology" });
    const invalid3DValues = hasInvalid3DValues(req.body);
    if (invalid3DValues) return res.status(400).json({ error: invalid3DValues });
    const invalidExplicitWidth = Array.isArray(req.body?.edges)
      && req.body.edges.some((edge) => (
        edge.widthMeters !== undefined
        && edge.widthMeters !== null
        && edge.widthMeters !== ""
        && (!Number.isFinite(Number(edge.widthMeters)) || Number(edge.widthMeters) <= 0)
      ));
    if (invalidExplicitWidth) {
      return res.status(400).json({ error: "Every corridor widthMeters must be greater than 0" });
    }
    const mapData = normalizeMapData(req.body);
    const validationError = validateMapData(mapData);
    if (validationError) return res.status(400).json({ error: validationError });
    fs.writeFile(MAP_FILE, JSON.stringify(mapData, null, 2), (err) => {
      if (err) return res.status(500).json({ error: "Failed to save map" });

      // Publish the new map to Pi via MQTT
      aedes.publish({
        topic: "building/config",
        payload: JSON.stringify(mapData),
        qos: 1,
        retain: true,
      });

      res.json({ success: true });
    });
  });

  // Socket.io for Real-time view updates
  io.on("connection", (socket) => {
    console.log("A client connected:", socket.id);
    socket.on("disconnect", () => {
      console.log("Client disconnected:", socket.id);
    });
  });

  app.post("/api/simulate", (req, res) => {
    fs.readFile(MAP_FILE, "utf8", (err, data) => {
      if (err) return res.status(500).json({ error: "Failed to read map" });
      try {
        const mapConfig = JSON.parse(data);
        const hasExit =
          mapConfig.areas && mapConfig.areas.some((a) => a.type === "exit");
        if (!hasExit) {
          return res.status(400).json({
            error:
              "Bản đồ cần có ít nhất một Lối thoát khẩn cấp để chạy giả lập.",
          });
        }

        simulationRunning = true;
        // Publish start signal to MQTT
        aedes.publish({
          topic: "building/simulation/start",
          payload: JSON.stringify({ action: "start" }),
          qos: 0,
          retain: false,
        });
        res.json({
          success: true,
          message: "Simulation start signal sent to Pi 5",
        });
      } catch (e) {
        res.status(500).json({ error: "Failed to parse map data" });
      }
    });
  });

  app.post("/api/simulate/resume", (req, res) => {
    aedes.publish({
      topic: "building/simulation/resume",
      payload: JSON.stringify({ action: "resume" }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Simulation resume signal sent to Pi 5" });
  });

  app.post("/api/simulate/stop", (req, res) => {
    simulationRunning = false;
    aedes.publish({
      topic: "building/simulation/stop",
      payload: JSON.stringify({ action: "stop" }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Simulation stop signal sent to Pi 5" });
  });

  app.post("/api/simulate/reset", (req, res) => {
    simulationRunning = false;
    aedes.publish({
      topic: "building/simulation/reset",
      payload: JSON.stringify({ action: "reset" }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Simulation reset signal sent to Pi 5" });
  });

  app.post("/api/occupancy/adjust", (req, res) => {
    const { edge_id, delta } = req.body;
    const numericDelta = Number(delta);
    if (!edge_id || !Number.isFinite(numericDelta) || numericDelta === 0) {
      return res
        .status(400)
        .json({ error: "edge_id and a non-zero numeric delta are required" });
    }
    aedes.publish({
      topic: "building/occupancy/adjust",
      payload: JSON.stringify({ edge_id, delta: numericDelta }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Occupancy adjustment sent to Pi 5" });
  });

  app.post("/api/hazard/adjust", (req, res) => {
    const { edge_id, hazard } = req.body;
    const numericHazard = Number(hazard);
    if (!edge_id || !Number.isFinite(numericHazard) || numericHazard < 0) {
      return res.status(400).json({ error: "edge_id and a non-negative hazard are required" });
    }
    aedes.publish({
      topic: "building/hazard/adjust",
      payload: JSON.stringify({ edge_id, hazard: numericHazard }),
      qos: 1,
      retain: false,
    });
    res.json({ success: true, message: "Hazard adjustment sent to Pi 5" });
  });

  // Incident APIs
  app.post("/api/incident", (req, res) => {
    const { type, target_id } = req.body; // type: 'edge' | 'exit'
    if (!type || !target_id)
      return res.status(400).json({ error: "Missing type or target_id" });

    aedes.publish({
      topic: "building/incident",
      payload: JSON.stringify({ type, target_id }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Incident signal sent" });
  });

  app.post("/api/incident/clear", (req, res) => {
    const { type, target_id } = req.body;
    if (!type || !target_id)
      return res.status(400).json({ error: "Missing type or target_id" });

    aedes.publish({
      topic: "building/incident/clear",
      payload: JSON.stringify({ type, target_id }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Incident clear signal sent" });
  });

  // Setup MQTT Broker (Aedes) on port 1883
  const mqttServer = net.createServer(aedes.handle);
  mqttServer.listen(MQTT_PORT, () => {
    console.log(`MQTT Broker is running on port ${MQTT_PORT}`);
  });

  aedes.on("client", (client) => {
    console.log(`MQTT Client Connected: ${client ? client.id : client}`);
  });

  aedes.on("clientDisconnect", (client) => {
    console.log(`MQTT Client Disconnected: ${client ? client.id : client}`);
  });

  // Handle incoming MQTT messages
  aedes.on("publish", (packet, client) => {
    if (client) {
      // Route normalized area occupancy updates to Web UI
      if (packet.topic === "building/occupancy") {
        try {
          const data = JSON.parse(packet.payload.toString());
          io.emit("occupancy_update", data);
        } catch (e) {
          console.error("Failed to parse occupancy data", e);
        }
      } else if (packet.topic === "building/occupancy/state") {
        try {
          io.emit("occupancy_state", JSON.parse(packet.payload.toString()));
        } catch (e) {
          console.error("Failed to parse occupancy state", e);
        }
      } else if (packet.topic === "building/incident_ack") {
        try {
          const data = JSON.parse(packet.payload.toString());
          io.emit("incident_update", data);
        } catch (e) {
          console.error("Failed to parse incident_ack data", e);
        }
      } else if (packet.topic === "building/log") {
        try {
          const data = JSON.parse(packet.payload.toString());
          io.emit("system_log", data);
        } catch (e) {
          console.error("Failed to parse log data", e);
        }
      } else if (packet.topic === "building/simulation/state") {
        try {
          const data = JSON.parse(packet.payload.toString());
          simulationRunning = data.status === "running";
          io.emit("simulation_state", data);
        } catch (e) {
          console.error("Failed to parse simulation state", e);
        }
      } else if (packet.topic === "building/occupancy/adjust_ack") {
        try {
          const data = JSON.parse(packet.payload.toString());
          io.emit("occupancy_adjust_ack", data);
        } catch (e) {
          console.error(
            "Failed to parse occupancy adjustment acknowledgement",
            e
          );
        }
      } else if (packet.topic === "building/guidance/state") {
        try {
          io.emit("guidance_state", JSON.parse(packet.payload.toString()));
        } catch (e) {
          console.error("Failed to parse guidance state", e);
        }
      } else if (
        packet.topic.startsWith("building/guidance/sign/") ||
        packet.topic.startsWith("building/guidance/speaker/")
      ) {
        try {
          io.emit("guidance_command", JSON.parse(packet.payload.toString()));
        } catch (e) {
          console.error("Failed to parse guidance command", e);
        }
      } else if (packet.topic.startsWith("building/guidance/ack/")) {
        try {
          io.emit("guidance_ack", JSON.parse(packet.payload.toString()));
        } catch (e) {
          console.error("Failed to parse guidance ACK", e);
        }
      }
    }
  });

  // Start Express + Socket.io Server
  server.listen(HTTP_PORT, () => {
    console.log("Web/API Server running on port", HTTP_PORT);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
