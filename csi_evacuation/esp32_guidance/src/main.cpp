#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <MD_MAX72xx.h>
#include <DFMiniMp3.h>
#include "device_config.h"

WiFiClient network;
PubSubClient mqtt(network);
MD_MAX72XX matrix(MD_MAX72XX::FC16_HW, WIEVAC_MAX7219_DATA, WIEVAC_MAX7219_CLK, WIEVAC_MAX7219_CS, WIEVAC_MAX7219_MODULES);
HardwareSerial dfSerial(2);

class Mp3Notify { public: static void OnError(uint16_t) {} static void OnPlayFinished(uint16_t) {} static void OnCardOnline(uint16_t) {} static void OnCardInserted(uint16_t) {} static void OnCardRemoved(uint16_t) {} };
DFMiniMp3<HardwareSerial, Mp3Notify> dfplayer(dfSerial);
uint32_t lastSequence = 0;
uint32_t validUntil = 0;

void publishAck(uint32_t sequence, const char* status, const char* detail) {
  StaticJsonDocument<256> ack;
  ack["device_id"] = WIEVAC_DEVICE_ID;
  ack["sequence"] = sequence;
  ack["status"] = status;
  ack["detail"] = detail;
  ack["applied_at"] = time(nullptr);
  char payload[256]; serializeJson(ack, payload);
  String topic = String("building/guidance/ack/") + WIEVAC_DEVICE_ID;
  mqtt.publish(topic.c_str(), payload, false);
}

void showIntent(const char* intent) {
  matrix.clear();
  // The deployed artwork can replace these compact symbols without changing MQTT.
  const char symbol = !strcmp(intent, "ARROW_LEFT") ? '<' : !strcmp(intent, "ARROW_RIGHT") ? '>' : !strcmp(intent, "DO_NOT_ENTER") ? 'X' : !strcmp(intent, "EXIT") ? 'E' : '^';
  matrix.setChar((WIEVAC_MAX7219_MODULES / 2), symbol);
}

uint16_t trackFor(const char* clip) {
  if (!strcmp(clip, "evacuate_left")) return 1;
  if (!strcmp(clip, "evacuate_right")) return 2;
  if (!strcmp(clip, "evacuate_straight")) return 3;
  if (!strcmp(clip, "turn_back")) return 4;
  if (!strcmp(clip, "shelter_in_place")) return 5;
  return 0;
}

void onCommand(char*, byte* raw, unsigned int length) {
  StaticJsonDocument<1024> command;
  if (deserializeJson(command, raw, length)) return;
  const uint32_t sequence = command["sequence"] | 0;
  if (!sequence || sequence <= lastSequence) return;
  lastSequence = sequence;
  validUntil = command["valid_until"] | 0;
  JsonObject presentation = command["presentation"];
  const char* visual = presentation["visual_intent"] | "DO_NOT_ENTER";
  const char* clip = presentation["audio_clip_id"] | "";
  showIntent(visual);
  uint16_t track = trackFor(clip);
  if (track) dfplayer.playMp3FolderTrack(track);
  publishAck(sequence, track || !strlen(clip) ? "display_applied" : "degraded", track || !strlen(clip) ? "display_and_audio_applied" : "dfplayer_track_unavailable");
}

void publishCapabilities() {
  StaticJsonDocument<384> doc;
  doc["firmware_version"] = "0.1.0";
  doc["audio"] = true;
  doc["languages"][0] = "vi";
  JsonObject display = doc.createNestedObject("display");
  display["type"] = "max7219";
  display["modules"] = WIEVAC_MAX7219_MODULES;
  display["supports_arrow"] = true;
  display["supports_load_bar"] = false;
  char payload[384]; serializeJson(doc, payload);
  String topic = String("building/guidance/capabilities/") + WIEVAC_DEVICE_ID;
  mqtt.publish(topic.c_str(), payload, true);
}

void connectMqtt() {
  while (!mqtt.connected()) {
    if (mqtt.connect(WIEVAC_DEVICE_ID)) {
      String topic = String("building/guidance/sign/") + WIEVAC_DEVICE_ID;
      mqtt.subscribe(topic.c_str(), 1);
      publishCapabilities();
    } else delay(1000);
  }
}

void setup() {
  matrix.begin(); matrix.control(MD_MAX72XX::INTENSITY, 3); showIntent("STANDBY");
  dfSerial.begin(9600, SERIAL_8N1, WIEVAC_DFPLAYER_RX, WIEVAC_DFPLAYER_TX); dfplayer.begin();
  WiFi.begin(WIEVAC_WIFI_SSID, WIEVAC_WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(300);
  mqtt.setServer(WIEVAC_MQTT_HOST, WIEVAC_MQTT_PORT); mqtt.setCallback(onCommand);
}

void loop() {
  connectMqtt(); mqtt.loop(); dfplayer.loop();
  if (validUntil && time(nullptr) > validUntil) { showIntent("STANDBY"); validUntil = 0; }
}
