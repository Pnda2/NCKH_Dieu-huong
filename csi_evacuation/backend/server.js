const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Aedes } = require("aedes");
const net = require("net");

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const MAP_FILE = path.join(__dirname, "map_data.json");
const DEFAULT_CORRIDOR_WIDTH_METERS = 1.2;

function normalizeMapData(mapData) {
  const edges = Array.isArray(mapData?.edges)
    ? mapData.edges.map((edge) => {
        const width = Number(edge.widthMeters);
        const hasValidWidth = Number.isFinite(width) && width > 0;
        return {
          ...edge,
          widthMeters: hasValidWidth ? width : DEFAULT_CORRIDOR_WIDTH_METERS,
          widthEstimated: hasValidWidth ? Boolean(edge.widthEstimated) : true,
        };
      })
    : [];
  return { ...mapData, edges };
}

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
    if (!Array.isArray(mapData.areas) || !Array.isArray(req.body?.edges)) {
      return res.status(400).json({ error: "Map must include areas and edges arrays" });
    }
    fs.writeFile(MAP_FILE, JSON.stringify(mapData, null, 2), (err) => {
      if (err) return res.status(500).json({ error: "Failed to save map" });

      // Publish the new map to Pi via MQTT
      aedes.publish({
        topic: "building/config",
        payload: JSON.stringify(mapData),
        qos: 0,
        retain: false,
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
    aedes.publish({
      topic: "building/simulation/stop",
      payload: JSON.stringify({ action: "stop" }),
      qos: 0,
      retain: false,
    });
    res.json({ success: true, message: "Simulation stop signal sent to Pi 5" });
  });

  app.post("/api/simulate/reset", (req, res) => {
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
  const MQTT_PORT = 1883;

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
  const PORT = 3001;
  server.listen(PORT, () => {
    console.log(`Web/API Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
