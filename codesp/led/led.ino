/*
  ========================================================================================
  WiEvac - Dynamic Emergency Corridor Guidance System
  Firmware Bảng hiệu Chỉ dẫn Hành lang Thực tế bằng LED P10 Full Màu (HUB75 32x16)
  Phần cứng: ESP32-S3 + Panel LED P10 RGB HUB75 16-pin (32x16 pixels)
  ========================================================================================
  
  TÍNH NĂNG TÍCH HỢP:
  1. Kết nối WiFi & MQTT tự động với máy chủ WiEvac (Port 1883).
  2. Phản hồi trạng thái (ACK & Capabilities) giúp Web UI hiển thị "ONLINE" xanh lá.
  3. Lắng nghe lệnh trực tiếp từ WiEvac (`building/guidance/sign/<DEVICE_ID>`).
  4. Lắng nghe trạng thái toàn hệ thống (`building/guidance/state`) & độ thông thoáng hành lang.
  5. CHẾ ĐỘ HIỂN THỊ ĐA DẠNG TRÊN MA TRẬN 32x16:
     - HÀNH LANG 1 HƯỚNG:
       + Mũi tên động chạy (streaming chevrons): TRÁI (LEFT), PHẢI (RIGHT), THẲNG (STRAIGHT).
       + Màu sắc theo ĐỘ THÔNG THOÁNG:
         * Xanh lá: Thông thoáng cao (>70%) -> Tuyến đường tối ưu, di chuyển nhanh.
         * Vàng: Thông thoáng vừa (40-70%) -> Đang có người, lưu ý.
         * Đỏ: Kém thông thoáng (<40%) -> Sắp quá tải.
     - HÀNH LANG TẮC NGHẼN / PHONG TỎA:
       + Quay lại (BACK / TURN_BACK): Biểu tượng chữ U / mũi tên ngược đỏ nhấp nháy + "QUAY LAI".
       + Nguy hiểm / Cấm vào (DO_NOT_ENTER / NO_SAFE_ROUTE): Dấu X đỏ chớp nháy + viền cảnh báo đỏ.
     - ĐẶT TẠI NGÃ 3 (JUNCTION SPLIT):
       + Chia màn hình 32x16 thành 2 nửa: Nửa Trái (15px) và Nửa Phải (15px).
       + So sánh 2 hướng thoát hiểm:
         * Bên nào THÔNG THOÁNG HƠN -> Mũi tên XANH LÁ nhấp nháy ưu tiên (khuyên nên đi).
         * Bên nào ĐẦY / TẮC NGHẼN -> Mũi tên ĐỎ hoặc VÀNG (hạn chế đi).
         * Bên nào BỊ KHÓA / CHÁY -> Dấu X ĐỎ cấm đi!
     - CỬA THOÁT HIỂM (EXIT):
       + Biểu tượng cửa thoát hiểm màu xanh lá + chữ "EXIT".
     - TRẠNG THÁI CHỜ (STANDBY):
       + Logo WiEvac và đèn trạng thái kết nối WiFi & MQTT.
  6. Xử lý bất đồng bộ (Non-blocking), duy trì tốc độ khung hình 20 FPS mượt mà.
  ========================================================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>

// ========================================================================================
// 1. CẤU HÌNH PHẦN CỨNG PANEL LED P10 (HUB75 16 CHÂN) CHO ESP32-S3
// ========================================================================================
#define PANEL_RES_X 32
#define PANEL_RES_Y 16
#define PANEL_CHAIN 1  // Số lượng tấm P10 nối tiếp

// Khớp 100% với cấu hình 16 chân HUB75 trên ESP32-S3 của bạn:
#define R1_PIN 4
#define G1_PIN 5
#define B1_PIN 6
#define R2_PIN 7
#define G2_PIN 15
#define B2_PIN 16
#define A_PIN  17
#define B_PIN  18
#define C_PIN  8
#define D_PIN  -1  // P10 16 hàng không dùng chân D
#define E_PIN  -1  // Không dùng
#define LAT_PIN 10
#define OE_PIN  11
#define CLK_PIN 9

MatrixPanel_I2S_DMA *dma_display = nullptr;

// ========================================================================================
// 2. CẤU HÌNH WIFI & MÁY CHỦ MQTT WIEVAC
// ========================================================================================
// Thay đổi thông tin mạng WiFi của bạn tại đây:
const char* WIFI_SSID     = "DYP05";      // Tên WiFi
const char* WIFI_PASSWORD = "12344321";  // Mật khẩu WiFi

// Địa chỉ IP của máy tính đang chạy WiEvac backend (Port 1883)
// Lưu ý: Đảm bảo máy tính và ESP32-S3 cùng kết nối chung một mạng WiFi / Hotspot.
const char* MQTT_HOST     = "192.168.1.184";
const uint16_t MQTT_PORT  = 1883;

// Định danh của bảng hiệu này trong hệ thống WiEvac
// Khớp với ID của thiết bị khi bạn thêm "+ BẢNG HIỆU" trên giao diện Web UI
const char* DEVICE_ID     = "sign_p10_01";

// (Tùy chọn) ID khu vực hành lang / nút ngã 3 muốn theo dõi trực tiếp từ đồ thị
// Ví dụ: Khu vực 3 ("a_1788182811417" - ngã 3 trên bản đồ mẫu)
// Nếu để rỗng "", bảng hiệu sẽ hoạt động thuần túy theo lệnh gán cho DEVICE_ID.
const char* MONITORED_AREA_ID = "a_1788182811417";

// ========================================================================================
// 3. ĐỊNH NGHĨA MÀU SẮC RGB 565
// ========================================================================================
inline uint16_t colorRGB(uint8_t r, uint8_t g, uint8_t b) {
  if (!dma_display) return 0;
  return dma_display->color565(r, g, b);
}

// Các màu chuẩn dùng trong chỉ dẫn thoát nạn WiEvac
#define CLR_BLACK      0x0000
#define CLR_GREEN      dma_display->color565(0, 255, 30)      // Thông thoáng cao / Tuyến ưu tiên
#define CLR_CYAN       dma_display->color565(0, 230, 255)     // Tín hiệu hướng dẫn WiEvac
#define CLR_YELLOW     dma_display->color565(255, 200, 0)     // Thông thoáng vừa / Tải trung bình
#define CLR_ORANGE     dma_display->color565(255, 100, 0)     // Cảnh báo / Tải cao
#define CLR_RED        dma_display->color565(255, 20, 20)     // Tắc nghẽn / Cấm vào / Hướng xấu
#define CLR_WHITE      dma_display->color565(255, 255, 255)
#define CLR_DARK_GRAY  dma_display->color565(35, 35, 45)      // Vạch ngăn cách
#define CLR_BLUE_DIM   dma_display->color565(20, 40, 70)

// ========================================================================================
// 4. BIẾN TRẠNG THÁI VÀ DỮ LIỆU ĐIỀU HƯỚNG
// ========================================================================================
enum DisplayMode {
  MODE_STANDBY,        // Chờ giả lập / Trạng thái bình thường
  MODE_SINGLE_ARROW,   // Điều hướng 1 hướng (Trái, Phải, Thẳng)
  MODE_TURN_BACK,      // Tắc nghẽn -> Quay lại
  MODE_BLOCKED,        // Nguy hiểm / Cấm vào
  MODE_JUNCTION,       // Đặt tại ngã 3 (So sánh 2 hướng)
  MODE_EXIT            // Cửa thoát hiểm
};

struct RouteInfo {
  String direction;    // "LEFT", "RIGHT", "STRAIGHT", "BACK"
  float share;         // 0.0 -> 1.0 (Tỷ lệ phân lưu / xác suất)
  float k;             // 0.0 (rỗng) -> 1.0 (tắc nghẽn)
  bool isBlocked;      // Bị phong tỏa / nguy hiểm
};

struct GuidanceState {
  DisplayMode mode = MODE_STANDBY;
  String command = "STANDBY";
  String direction = "STANDBY";
  String loadLevel = "clear";
  uint32_t sequence = 0;
  uint32_t validUntil = 0;
  bool simRunning = false;

  // Dữ liệu ngã 3 (so sánh 2 hướng)
  bool isJunction = false;
  RouteInfo routeLeft;
  RouteInfo routeRight;
  String recommendedSide = "NONE"; // "LEFT", "RIGHT", "EQUAL", "NONE"
} gState;

WiFiClient netClient;
PubSubClient mqttClient(netClient);

unsigned long lastAnimTick = 0;
unsigned long lastMqttRetry = 0;
unsigned long lastHeartbeat = 0;
uint8_t animStep = 0;
bool blinkToggle = false;

// ========================================================================================
// 5. GỬI BÁO CÁO NĂNG LỰC & XÁC NHẬN ACK ĐẾN WIEVAC
// ========================================================================================
void publishCapabilities() {
  StaticJsonDocument<384> doc;
  doc["device_id"] = DEVICE_ID;
  doc["firmware_version"] = "1.0.0-p10";
  doc["display_type"] = "hub75_p10_rgb";
  doc["resolution"] = "32x16";
  doc["supports_junction_split"] = true;
  doc["supports_clearance_levels"] = true;

  char payload[384];
  serializeJson(doc, payload);
  String topic = String("building/guidance/capabilities/") + DEVICE_ID;
  mqttClient.publish(topic.c_str(), payload, true);
  Serial.println("[WiEvac] Da gui ban tin Capabilities.");
}

void publishAck(uint32_t seq, const char* status, const char* detail, const char* devId = DEVICE_ID) {
  StaticJsonDocument<256> ack;
  ack["device_id"] = devId;
  ack["sequence"] = seq;
  ack["status"] = status;
  ack["detail"] = detail;
  ack["applied_at"] = millis() / 1000;

  char payload[256];
  serializeJson(ack, payload);
  String topic = String("building/guidance/ack/") + devId;
  mqttClient.publish(topic.c_str(), payload, false);
}

// ========================================================================================
// 6. XỬ LÝ LỆNH TỪ MÁY CHỦ WIEVAC (MQTT CALLBACK)
// ========================================================================================
void processSignCommand(JsonObject& doc) {
  const uint32_t seq = doc["sequence"] | 0;
  gState.sequence = seq;
  gState.validUntil = doc["valid_until"] | 0;

  const char* cmd = doc["command"] | "STANDBY";
  const char* dir = doc["direction"] | cmd;
  gState.command = String(cmd);
  gState.direction = String(dir);

  JsonObject pres = doc["presentation"];
  if (!pres.isNull()) {
    gState.loadLevel = String(pres["load_level"] | "clear");
  }

  // Kiểm tra xem lệnh có kèm theo phân luồng ngã 3 (routes) không
  JsonArray routes = doc["routes"];
  if (routes.size() >= 2) {
    gState.isJunction = true;
    gState.mode = MODE_JUNCTION;

    // Reset thông tin 2 nhánh
    gState.routeLeft = {"LEFT", 0.0f, 0.5f, false};
    gState.routeRight = {"RIGHT", 0.0f, 0.5f, false};

    for (JsonObject r : routes) {
      String rDir = String(r["direction"] | "");
      float share = r["probability"] | 0.0f;
      float k = r["k"] | 0.5f;

      if (rDir == "LEFT") {
        gState.routeLeft.share = share;
        gState.routeLeft.k = k;
        gState.routeLeft.isBlocked = (k >= 0.95f);
      } else if (rDir == "RIGHT") {
        gState.routeRight.share = share;
        gState.routeRight.k = k;
        gState.routeRight.isBlocked = (k >= 0.95f);
      }
    }

    // Đánh giá nhánh nào tối ưu hơn dựa trên xác suất luồng & độ thông thoáng
    if (gState.routeLeft.isBlocked && !gState.routeRight.isBlocked) {
      gState.recommendedSide = "RIGHT";
    } else if (gState.routeRight.isBlocked && !gState.routeLeft.isBlocked) {
      gState.recommendedSide = "LEFT";
    } else if (gState.routeLeft.share > gState.routeRight.share + 0.1f) {
      gState.recommendedSide = "LEFT";
    } else if (gState.routeRight.share > gState.routeLeft.share + 0.1f) {
      gState.recommendedSide = "RIGHT";
    } else {
      gState.recommendedSide = "EQUAL";
    }
  } else {
    gState.isJunction = false;

    // Xác định chế độ hiển thị 1 hướng
    if (gState.command == "STANDBY") {
      gState.mode = MODE_STANDBY;
    } else if (gState.command == "BACK" || gState.command == "TURN_BACK") {
      gState.mode = MODE_TURN_BACK;
    } else if (gState.command == "DO_NOT_ENTER" || gState.command == "NO_SAFE_ROUTE") {
      gState.mode = MODE_BLOCKED;
    } else if (gState.command == "EXIT") {
      gState.mode = MODE_EXIT;
    } else {
      gState.mode = MODE_SINGLE_ARROW;
    }
  }

  // Gửi xác nhận lại máy chủ WiEvac để đổi trạng thái UI sang ONLINE
  const char* devId = doc["device_id"] | DEVICE_ID;
  publishAck(seq, "display_applied", "p10_matrix_updated", devId);
  Serial.printf("[WiEvac] Lenh: %s, Huong: %s, Ngã 3: %s (ID: %s)\n", 
                cmd, dir, gState.isJunction ? "CO" : "KHONG", devId);
}

void processBuildingState(JsonObject& doc) {
  // Nếu có cấu hình MONITORED_AREA_ID, ta có thể tự động bám theo quyết định của nút đó
  if (strlen(MONITORED_AREA_ID) == 0) return;

  JsonObject decisions = doc["decisions"];
  if (decisions.isNull()) return;

  JsonObject areaDec = decisions[MONITORED_AREA_ID];
  if (areaDec.isNull()) return;

  JsonArray routes = areaDec["routes"];
  if (routes.size() >= 2) {
    gState.isJunction = true;
    gState.mode = MODE_JUNCTION;
    gState.routeLeft = {"LEFT", 0.0f, 0.5f, false};
    gState.routeRight = {"RIGHT", 0.0f, 0.5f, false};

    for (JsonObject r : routes) {
      String edgeId = String(r["edge_id"] | "");
      float share = r["probability"] | 0.0f;
      float k = r["k"] | 0.5f;

      // Giả lập nhánh: route đầu tiên sang Trái, route thứ hai sang Phải
      if (gState.routeLeft.share == 0.0f) {
        gState.routeLeft.share = share;
        gState.routeLeft.k = k;
        gState.routeLeft.isBlocked = (k >= 0.95f);
      } else {
        gState.routeRight.share = share;
        gState.routeRight.k = k;
        gState.routeRight.isBlocked = (k >= 0.95f);
      }
    }

    if (gState.routeLeft.isBlocked && !gState.routeRight.isBlocked) {
      gState.recommendedSide = "RIGHT";
    } else if (gState.routeRight.isBlocked && !gState.routeLeft.isBlocked) {
      gState.recommendedSide = "LEFT";
    } else if (gState.routeLeft.share >= gState.routeRight.share) {
      gState.recommendedSide = "LEFT";
    } else {
      gState.recommendedSide = "RIGHT";
    }
  } else if (routes.size() == 1) {
    gState.isJunction = false;
    float k = routes[0]["k"] | 0.5f;
    if (k >= 0.95f) {
      gState.mode = MODE_TURN_BACK;
    } else {
      gState.mode = MODE_SINGLE_ARROW;
      gState.direction = "STRAIGHT";
    }
  }
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  // Bộ nhớ đệm phân tích JSON
  DynamicJsonDocument doc(2048);
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.print("[MQTT] Loi parse JSON: ");
    Serial.println(err.c_str());
    return;
  }

  String strTopic = String(topic);

  // 1. Nhận lệnh trực tiếp cho bảng hiệu (bắt tất cả các bảng hiệu hoặc ID cụ thể)
  if (strTopic.startsWith("building/guidance/sign/")) {
    JsonObject obj = doc.as<JsonObject>();
    processSignCommand(obj);
    return;
  }

  // 2. Nhận trạng thái toàn tòa nhà
  if (strTopic == "building/guidance/state") {
    JsonObject obj = doc.as<JsonObject>();
    processBuildingState(obj);
    return;
  }

  // 3. Tín hiệu bắt đầu / dừng giả lập
  if (strTopic == "building/simulation/start") {
    gState.simRunning = true;
    Serial.println("[WiEvac] Bat dau gia lap thoat hiem.");
  } else if (strTopic == "building/simulation/stop" || strTopic == "building/simulation/reset") {
    gState.simRunning = false;
    gState.mode = MODE_STANDBY;
    Serial.println("[WiEvac] Dung / Dat lai gia lap.");
  } else if (strTopic == "building/simulation/state") {
    const char* status = doc["status"] | "idle";
    gState.simRunning = (!strcmp(status, "running"));
    if (!gState.simRunning && gState.mode != MODE_BLOCKED) {
      gState.mode = MODE_STANDBY;
    }
  }
}

// ========================================================================================
// 7. KẾT NỐI WIFI & MQTT (NON-BLOCKING)
// ========================================================================================
void setupWifi() {
  Serial.print("Connecting to WiFi: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void checkMqttConnection() {
  if (mqttClient.connected()) return;

  unsigned long now = millis();
  if (now - lastMqttRetry < 3000) return; // Thử lại sau mỗi 3 giây, không delay
  lastMqttRetry = now;

  Serial.printf("[MQTT] Dang ket noi toi %s:%d...\n", MQTT_HOST, MQTT_PORT);
  if (mqttClient.connect(DEVICE_ID)) {
    Serial.println("[MQTT] Ket noi thanh cong!");

    // Đăng ký nhận lệnh tất cả bảng hiệu trong hệ thống
    mqttClient.subscribe("building/guidance/sign/#", 1);

    // Đăng ký nhận trạng thái toàn cục & giả lập
    mqttClient.subscribe("building/guidance/state", 1);
    mqttClient.subscribe("building/simulation/start", 0);
    mqttClient.subscribe("building/simulation/stop", 0);
    mqttClient.subscribe("building/simulation/reset", 0);
    mqttClient.subscribe("building/simulation/state", 0);

    // Gửi báo cáo thông số thiết bị
    publishCapabilities();
    publishAck(0, "connected", "esp32_p10_online");
  } else {
    Serial.printf("[MQTT] Ket noi that bai, rc=%d\n", mqttClient.state());
  }
}

// ========================================================================================
// 8. CÁC HÀM VẼ ĐỒ HỌA TRÊN MA TRẬN P10 (32x16 RGB)
// ========================================================================================

// Vẽ mũi tên sang Trái (chevrons chảy động)
void drawStreamingArrowLeft(uint16_t color, uint8_t offset) {
  // Vẽ 3 cặp dấu < di chuyển sang trái
  for (int c = 0; c < 3; c++) {
    int baseX = 24 - c * 9 - offset;
    if (baseX < -4) baseX += 27;

    for (int dy = 0; dy <= 5; dy++) {
      int px = baseX + dy;
      int pyTop = 8 - dy;
      int pyBot = 8 + dy;
      if (px >= 0 && px < 32 && pyTop >= 0 && pyTop < 16) dma_display->drawPixel(px, pyTop, color);
      if (px >= 0 && px < 32 && pyBot >= 0 && pyBot < 16) dma_display->drawPixel(px, pyBot, color);
      // Đổ dày 2 pixel cho mũi tên rõ nét
      if (px + 1 >= 0 && px + 1 < 32 && pyTop >= 0 && pyTop < 16) dma_display->drawPixel(px + 1, pyTop, color);
      if (px + 1 >= 0 && px + 1 < 32 && pyBot >= 0 && pyBot < 16) dma_display->drawPixel(px + 1, pyBot, color);
    }
  }
}

// Vẽ mũi tên sang Phải (chevrons chảy động)
void drawStreamingArrowRight(uint16_t color, uint8_t offset) {
  for (int c = 0; c < 3; c++) {
    int baseX = 6 + c * 9 + offset;
    if (baseX > 35) baseX -= 27;

    for (int dy = 0; dy <= 5; dy++) {
      int px = baseX - dy;
      int pyTop = 8 - dy;
      int pyBot = 8 + dy;
      if (px >= 0 && px < 32 && pyTop >= 0 && pyTop < 16) dma_display->drawPixel(px, pyTop, color);
      if (px >= 0 && px < 32 && pyBot >= 0 && pyBot < 16) dma_display->drawPixel(px, pyBot, color);
      if (px - 1 >= 0 && px - 1 < 32 && pyTop >= 0 && pyTop < 16) dma_display->drawPixel(px - 1, pyTop, color);
      if (px - 1 >= 0 && px - 1 < 32 && pyBot >= 0 && pyBot < 16) dma_display->drawPixel(px - 1, pyBot, color);
    }
  }
}

// Vẽ mũi tên Đi Thẳng (hướng lên)
void drawStreamingArrowUp(uint16_t color, uint8_t offset) {
  int cy = (offset % 6);
  // Thân mũi tên
  dma_display->fillRect(14, 6, 4, 9, color);
  // Đầu mũi tên ^
  for (int i = 0; i < 7; i++) {
    dma_display->drawPixel(15 - i, 7 - (i / 2), color);
    dma_display->drawPixel(16 + i, 7 - (i / 2), color);
  }
  // Hiệu ứng sóng đẩy lên
  int waveY = 14 - (cy * 2);
  if (waveY >= 0 && waveY < 16) {
    dma_display->drawFastHLine(12, waveY, 8, CLR_WHITE);
  }
}

// Vẽ cảnh báo QUAY LẠI khi hành lang tắc nghẽn (TURN BACK / U-TURN)
void drawTurnBackWarning(bool blink) {
  uint16_t primaryClr = blink ? CLR_RED : CLR_ORANGE;

  // Biểu tượng chữ U lộn ngược (Quay đầu) ở nửa trái (X: 2..13)
  dma_display->drawFastHLine(5, 2, 7, primaryClr);
  dma_display->drawFastVLine(4, 3, 7, primaryClr);
  dma_display->drawFastVLine(12, 3, 10, primaryClr);
  // Đầu mũi tên chỉ xuống ở chân chữ U (X: 12, Y: 12)
  dma_display->drawPixel(11, 11, primaryClr);
  dma_display->drawPixel(13, 11, primaryClr);
  dma_display->drawPixel(10, 10, primaryClr);
  dma_display->drawPixel(14, 10, primaryClr);

  // Chữ cảnh báo ngắn "QUAY LAI" hoặc "BACK" ở nửa phải (X: 16..31)
  dma_display->setTextColor(blink ? CLR_WHITE : CLR_RED);
  dma_display->setTextSize(1);
  dma_display->setCursor(16, 1);
  dma_display->print("QUAY");
  dma_display->setCursor(16, 9);
  dma_display->print("LAI!");
}

// Vẽ biểu tượng CẤM VÀO / PHONG TỎA (DO NOT ENTER / NO ROUTE)
void drawBlockedWarning(bool blink) {
  uint16_t borderClr = blink ? CLR_RED : dma_display->color565(120, 0, 0);

  // Viền đỏ bao quanh
  dma_display->drawRect(0, 0, 32, 16, borderClr);

  // Dấu gạch chéo đỏ lớn (X)
  dma_display->drawLine(3, 2, 28, 13, CLR_RED);
  dma_display->drawLine(4, 2, 29, 13, CLR_RED);
  dma_display->drawLine(28, 2, 3, 13, CLR_RED);
  dma_display->drawLine(29, 2, 4, 13, CLR_RED);

  // Chữ STOP hoặc CAM ở giữa
  dma_display->fillRect(7, 4, 18, 8, CLR_BLACK);
  dma_display->setTextColor(blink ? CLR_WHITE : CLR_RED);
  dma_display->setTextSize(1);
  dma_display->setCursor(8, 5);
  dma_display->print("STOP");
}

// Vẽ Cửa thoát hiểm (EXIT)
void drawExitSign() {
  dma_display->fillRect(1, 1, 30, 14, dma_display->color565(0, 80, 20));
  dma_display->drawRect(0, 0, 32, 16, CLR_GREEN);

  // Chữ EXIT nổi bật
  dma_display->setTextColor(CLR_WHITE);
  dma_display->setTextSize(1);
  dma_display->setCursor(5, 4);
  dma_display->print("EXIT");

  // Mũi tên nhỏ chỉ lối ra bên phải
  dma_display->drawPixel(27, 8, CLR_WHITE);
  dma_display->drawPixel(26, 7, CLR_WHITE);
  dma_display->drawPixel(26, 9, CLR_WHITE);
}

// Vẽ chế độ NGÃ 3: SO SÁNH 2 HƯỚNG TRÁI / PHẢI
// Hiển thị trực quan: Hướng nào ĐẦY (Đỏ), Hướng nào TRỐNG (Xanh), Nên đi bên nào!
void drawJunctionComparison(uint8_t step, bool blink) {
  // 1. Vạch phân cách trung tâm (X: 15..16)
  dma_display->drawFastVLine(15, 0, 15, CLR_DARK_GRAY);

  // 2. Đánh giá màu sắc & icon cho NỬA TRÁI (X: 0..14)
  uint16_t leftColor;
  bool leftRecommended = (gState.recommendedSide == "LEFT");

  if (gState.routeLeft.isBlocked) {
    leftColor = CLR_RED;
  } else if (gState.routeLeft.k >= 0.75f) {
    leftColor = CLR_RED;       // Đầy / Tắc
  } else if (gState.routeLeft.k >= 0.45f) {
    leftColor = CLR_YELLOW;    // Tải vừa
  } else {
    leftColor = CLR_GREEN;     // Thông thoáng cao
  }

  // Vẽ nửa trái:
  if (gState.routeLeft.isBlocked) {
    // Dấu X nhỏ báo cấm rẽ trái
    dma_display->drawLine(3, 3, 11, 11, CLR_RED);
    dma_display->drawLine(11, 3, 3, 11, CLR_RED);
  } else {
    // Mũi tên chỉ rẽ Trái
    int offset = leftRecommended ? (step % 4) : 0;
    int arrowTipX = 3 - offset;
    if (arrowTipX < 1) arrowTipX += 4;

    // Vẽ mũi tên trái nhỏ (vừa vặn khung 14 pixel)
    dma_display->drawFastHLine(arrowTipX, 7, 8, leftColor);
    dma_display->drawPixel(arrowTipX + 1, 6, leftColor);
    dma_display->drawPixel(arrowTipX + 1, 8, leftColor);
    dma_display->drawPixel(arrowTipX + 2, 5, leftColor);
    dma_display->drawPixel(arrowTipX + 2, 9, leftColor);

    // Nếu đây là hướng NÊN ĐI: vẽ khung xanh nhấp nháy hoặc chữ "OK"
    if (leftRecommended && blink) {
      dma_display->drawPixel(1, 1, CLR_GREEN);
      dma_display->drawPixel(13, 1, CLR_GREEN);
    }
  }

  // 3. Đánh giá màu sắc & icon cho NỬA PHẢI (X: 16..31)
  uint16_t rightColor;
  bool rightRecommended = (gState.recommendedSide == "RIGHT");

  if (gState.routeRight.isBlocked) {
    rightColor = CLR_RED;
  } else if (gState.routeRight.k >= 0.75f) {
    rightColor = CLR_RED;       // Đầy / Tắc
  } else if (gState.routeRight.k >= 0.45f) {
    rightColor = CLR_YELLOW;    // Tải vừa
  } else {
    rightColor = CLR_GREEN;     // Thông thoáng cao
  }

  // Vẽ nửa phải:
  if (gState.routeRight.isBlocked) {
    // Dấu X nhỏ báo cấm rẽ phải
    dma_display->drawLine(20, 3, 28, 11, CLR_RED);
    dma_display->drawLine(28, 3, 20, 11, CLR_RED);
  } else {
    // Mũi tên chỉ rẽ Phải
    int offset = rightRecommended ? (step % 4) : 0;
    int arrowTipX = 27 + offset;
    if (arrowTipX > 29) arrowTipX -= 4;

    dma_display->drawFastHLine(18, 7, arrowTipX - 18, rightColor);
    dma_display->drawPixel(arrowTipX - 1, 6, rightColor);
    dma_display->drawPixel(arrowTipX - 1, 8, rightColor);
    dma_display->drawPixel(arrowTipX - 2, 5, rightColor);
    dma_display->drawPixel(arrowTipX - 2, 9, rightColor);

    if (rightRecommended && blink) {
      dma_display->drawPixel(17, 1, CLR_GREEN);
      dma_display->drawPixel(30, 1, CLR_GREEN);
    }
  }

  // 4. Thanh tỷ lệ độ thông thoáng ở hàng đáy (Y: 15)
  // Nửa trái: độ thoáng = 1.0 - k
  int leftClearPixels = max(1, min(14, (int)((1.0f - gState.routeLeft.k) * 14.0f)));
  dma_display->drawFastHLine(0, 15, leftClearPixels, leftColor);

  // Nửa phải:
  int rightClearPixels = max(1, min(14, (int)((1.0f - gState.routeRight.k) * 14.0f)));
  dma_display->drawFastHLine(31 - rightClearPixels, 15, rightClearPixels, rightColor);
}

// Vẽ chế độ CHỜ (STANDBY / SẴN SÀNG)
void drawStandbyScreen(uint8_t step) {
  // Chữ WiEvac cách điệu
  dma_display->setTextColor(CLR_CYAN);
  dma_display->setTextSize(1);
  dma_display->setCursor(2, 4);
  dma_display->print("WiEvac");

  // Đèn báo kết nối mạng ở góc trên bên phải
  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  bool mqttOk = mqttClient.connected();

  // Pixel WiFi (X: 29, Y: 1)
  dma_display->drawPixel(29, 1, wifiOk ? CLR_GREEN : CLR_RED);
  // Pixel MQTT (X: 30, Y: 1)
  dma_display->drawPixel(30, 1, mqttOk ? CLR_CYAN : CLR_RED);

  // Radar quét nhẹ ở hàng đáy báo hệ thống đang online
  int radarX = (step % 32);
  dma_display->drawPixel(radarX, 15, CLR_CYAN);
}

// ========================================================================================
// 9. BẬT MÀN HÌNH VÀ VÒNG LẶP CHÍNH
// ========================================================================================
void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("==================================================");
  Serial.println("   KHOI DONG BANG HIEU WIEVAC P10 FULL MAU HUB75   ");
  Serial.println("==================================================");

  // Cấu hình panel HUB75 DMA
  HUB75_I2S_CFG mxconfig(PANEL_RES_X, PANEL_RES_Y, PANEL_CHAIN);
  mxconfig.gpio.r1 = R1_PIN;
  mxconfig.gpio.g1 = G1_PIN;
  mxconfig.gpio.b1 = B1_PIN;
  mxconfig.gpio.r2 = R2_PIN;
  mxconfig.gpio.g2 = G2_PIN;
  mxconfig.gpio.b2 = B2_PIN;
  mxconfig.gpio.a = A_PIN;
  mxconfig.gpio.b = B_PIN;
  mxconfig.gpio.c = C_PIN;
  mxconfig.gpio.d = D_PIN;
  mxconfig.gpio.e = E_PIN;
  mxconfig.gpio.lat = LAT_PIN;
  mxconfig.gpio.oe = OE_PIN;
  mxconfig.gpio.clk = CLK_PIN;

  // Nếu panel của bạn dùng chip quét đặc biệt, mở ghi chú 1 trong 2 dòng dưới:
  // mxconfig.driver = HUB75_I2S_CFG::SHIFTREG;
  // mxconfig.driver = HUB75_I2S_CFG::FM6126A;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(85); // Độ sáng chuẩn (0-255)
  dma_display->clearScreen();

  // Test màu chào mừng
  dma_display->fillScreen(CLR_CYAN);
  delay(300);
  dma_display->clearScreen();

  // Khởi động mạng
  setupWifi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(2048); // Đảm bảo bộ đệm đủ lớn cho bản tin WiEvac
}

void loop() {
  // 1. Duy trì kết nối mạng MQTT
  if (WiFi.status() == WL_CONNECTED) {
    checkMqttConnection();
    mqttClient.loop();
  }

  // 2. Gửi heartbeat định kỳ 5 giây
  unsigned long now = millis();
  if (now - lastHeartbeat >= 5000) {
    lastHeartbeat = now;
    if (mqttClient.connected()) {
      publishAck(gState.sequence, "heartbeat", "sign_alive");
    }
  }

  // 3. Tự động chuyển về STANDBY nếu lệnh đã quá hạn (valid_until)
  if (gState.validUntil > 0 && (millis() / 1000) > gState.validUntil) {
    if (gState.mode != MODE_STANDBY && !gState.simRunning) {
      gState.mode = MODE_STANDBY;
      gState.validUntil = 0;
    }
  }

  // 4. Vẽ khung hình hiển thị (Cập nhật 20 FPS = mỗi 50ms)
  if (now - lastAnimTick >= 50) {
    lastAnimTick = now;
    animStep++;
    if (animStep % 6 == 0) blinkToggle = !blinkToggle;

    dma_display->clearScreen();

    // Chọn màu dựa theo độ thông thoáng hiện tại
    uint16_t dynamicColor = CLR_GREEN;
    if (gState.loadLevel == "congested") {
      dynamicColor = CLR_RED;
    } else if (gState.loadLevel == "busy") {
      dynamicColor = CLR_YELLOW;
    }

    // Hiển thị theo từng chế độ
    switch (gState.mode) {
      case MODE_SINGLE_ARROW:
        if (gState.direction == "LEFT") {
          drawStreamingArrowLeft(dynamicColor, animStep % 9);
        } else if (gState.direction == "RIGHT") {
          drawStreamingArrowRight(dynamicColor, animStep % 9);
        } else {
          drawStreamingArrowUp(dynamicColor, animStep);
        }
        break;

      case MODE_JUNCTION:
        // Đặt tại ngã 3: hiển thị so sánh 2 nhánh Trái - Phải
        drawJunctionComparison(animStep, blinkToggle);
        break;

      case MODE_TURN_BACK:
        // Hành lang tắc nghẽn -> yêu cầu quay lại
        drawTurnBackWarning(blinkToggle);
        break;

      case MODE_BLOCKED:
        // Tuyến đường nguy hiểm / Cấm vào
        drawBlockedWarning(blinkToggle);
        break;

      case MODE_EXIT:
        // Cửa thoát hiểm
        drawExitSign();
        break;

      case MODE_STANDBY:
      default:
        drawStandbyScreen(animStep);
        break;
    }
  }
}
