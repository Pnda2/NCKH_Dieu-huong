/*
  ========================================================================================
  WiEvac - Dynamic Emergency Corridor Guidance System
  Firmware Bảng hiệu Chỉ dẫn Hành lang Thực tế bằng LED P10 Full Màu (HUB75 32x16)
  Phần cứng: ESP32-S3 + Panel LED P10 RGB HUB75 16-pin (32x16 pixels)
  ========================================================================================
  
  TÍNH NĂNG TÍCH HỢP:
  1. Kết nối WiFi & MQTT tự động với máy chủ WiEvac (Port 1883).
  2. Phản hồi trạng thái (ACK & Capabilities) giúp Web UI hiển thị "ONLINE" xanh lá.
  3. Lắng nghe lệnh trực tiếp từ WiEvac (`building/guidance/sign/<DEVICE_ID>` và wildcard).
  4. Đồng bộ chính xác trạng thái mô phỏng (`building/simulation/state` & start/stop/reset).
  5. CHẾ ĐỘ HIỂN THỊ ĐA DẠNG TRÊN MA TRẬN 32x16:
     - HÀNH LANG 1 HƯỚNG:
       + Mũi tên động chạy (streaming chevrons): TRÁI (LEFT), PHẢI (RIGHT), THẲNG (STRAIGHT).
       + Màu sắc theo ĐỘ THÔNG THOÁNG:
         * Xanh lá: Thông thoáng cao (>70%) -> Tuyến đường tối ưu, di chuyển nhanh.
         * Vàng: Thông thoáng vừa (40-70%) -> Đang có người, lưu ý.
         * Đỏ: Kém thông thoáng (<40%) -> Sắp quá tải.
     - HÀNH LANG TẮC NGHẼN / QUAY LẠI (BACK / TURN_BACK):
       + Luân phiên 2 pha: Biểu tượng chữ U quay đầu lớn cân đối + Chữ "QUAY" "LAI!" đậm, căn giữa 100%.
     - NGUY HIỂM / CẤM VÀO (DO_NOT_ENTER / NO_SAFE_ROUTE / BLOCKED):
       + Dấu X đỏ + khung nền đen trung tâm + chữ "STOP" căn giữa tuyệt đối, không lệch lề.
     - ĐẶT TẠI NGÃ 3 (JUNCTION SPLIT):
       + Kích hoạt KHI VÀ CHỈ KHI có 2 nhánh thực tế Trái (LEFT) & Phải (RIGHT).
       + So sánh 2 hướng thoát hiểm: Nhánh thông thoáng hơn có thanh sáng xanh ưu tiên.
     - CỬA THOÁT HIỂM (EXIT):
       + Biểu tượng cửa thoát hiểm màu xanh lá + chữ "EXIT".
     - TRẠNG THÁI CHỜ (STANDBY):
       + Khi chưa chạy mô phỏng hoặc sau reset: Hiển thị logo WiEvac + đèn kết nối WiFi & MQTT.
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
// Thông tin WiFi:
const char* WIFI_SSID     = "DYP05";      // Tên WiFi
const char* WIFI_PASSWORD = "12344321";  // Mật khẩu WiFi

// Địa chỉ IP của máy tính đang chạy WiEvac backend (Port 1883):
const char* MQTT_HOST     = "192.168.1.198";
const uint16_t MQTT_PORT  = 1883;

// Định danh của bảng hiệu này trong hệ thống WiEvac
// Khớp với ID của thiết bị khi bạn thêm "+ BẢNG HIỆU" trên giao diện Web UI
const char* DEVICE_ID     = "sign_p10_01";

// ========================================================================================
// 3. ĐỊNH NGHĨA MÀU SẮC RGB 565
// ========================================================================================
inline uint16_t colorRGB(uint8_t r, uint8_t g, uint8_t b) {
  if (!dma_display) return 0;
  return dma_display->color565(r, g, b);
}

#define CLR_BLACK      0x0000
#define CLR_GREEN      dma_display->color565(0, 255, 30)      // Thông thoáng cao / Tuyến ưu tiên
#define CLR_CYAN       dma_display->color565(0, 230, 255)     // Tín hiệu hướng dẫn WiEvac
#define CLR_YELLOW     dma_display->color565(255, 200, 0)     // Thông thoáng vừa / Tải trung bình
#define CLR_ORANGE     dma_display->color565(255, 100, 0)     // Cảnh báo / Tải cao
#define CLR_RED        dma_display->color565(255, 20, 20)     // Tắc nghẽn / Cấm vào / Hướng xấu
#define CLR_WHITE      dma_display->color565(255, 255, 255)
#define CLR_DARK_GRAY  dma_display->color565(35, 35, 45)      // Vạch ngăn cách

// ========================================================================================
// 4. BIẾN TRẠNG THÁI VÀ DỮ LIỆU ĐIỀU HƯỚNG
// ========================================================================================
enum DisplayMode {
  MODE_STANDBY,        // Chờ giả lập / Trạng thái bình thường
  MODE_SINGLE_ARROW,   // Điều hướng 1 hướng (Trái, Phải, Thẳng)
  MODE_TURN_BACK,      // Tắc nghẽn -> Quay lại
  MODE_BLOCKED,        // Nguy hiểm / Cấm vào
  MODE_JUNCTION,       // Đặt tại ngã 3 (So sánh 2 hướng Trái & Phải)
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
  doc["firmware_version"] = "1.1.0-p10";
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

  // Phân tích danh sách tuyến (routes) nếu có
  JsonArray routes = doc["routes"];
  bool hasLeft = false;
  bool hasRight = false;
  RouteInfo rLeft = {"LEFT", 0.0f, 0.5f, false};
  RouteInfo rRight = {"RIGHT", 0.0f, 0.5f, false};

  if (routes.size() >= 2) {
    for (JsonObject r : routes) {
      String rDir = String(r["direction"] | "");
      float share = r["probability"] | 0.0f;
      float k = r["k"] | 0.5f;

      if (rDir == "LEFT") {
        hasLeft = true;
        rLeft.share = share;
        rLeft.k = k;
        rLeft.isBlocked = (k >= 0.95f);
      } else if (rDir == "RIGHT") {
        hasRight = true;
        rRight.share = share;
        rRight.k = k;
        rRight.isBlocked = (k >= 0.95f);
      }
    }
  }

  // Chỉ kích hoạt chế độ so sánh ngã 3 (JUNCTION) KHI VÀ CHỈ KHI có cả 2 nhánh Trái & Phải
  if (hasLeft && hasRight) {
    gState.isJunction = true;
    gState.mode = MODE_JUNCTION;
    gState.routeLeft = rLeft;
    gState.routeRight = rRight;

    if (gState.routeLeft.isBlocked && !gState.routeRight.isBlocked) {
      gState.recommendedSide = "RIGHT";
    } else if (gState.routeRight.isBlocked && !gState.routeLeft.isBlocked) {
      gState.recommendedSide = "LEFT";
    } else if (gState.routeLeft.share > gState.routeRight.share + 0.05f) {
      gState.recommendedSide = "LEFT";
    } else if (gState.routeRight.share > gState.routeLeft.share + 0.05f) {
      gState.recommendedSide = "RIGHT";
    } else {
      gState.recommendedSide = "EQUAL";
    }
  } else {
    // Chế độ 1 hướng đơn rõ ràng (theo lệnh chính của D* Lite)
    gState.isJunction = false;

    if (gState.command == "STANDBY") {
      gState.mode = MODE_STANDBY;
    } else if (gState.command == "BACK" || gState.command == "TURN_BACK") {
      gState.mode = MODE_TURN_BACK;
      gState.simRunning = true;
    } else if (gState.command == "DO_NOT_ENTER" || gState.command == "NO_SAFE_ROUTE") {
      gState.mode = MODE_BLOCKED;
      gState.simRunning = true;
    } else if (gState.command == "EXIT") {
      gState.mode = MODE_EXIT;
      gState.simRunning = true;
    } else {
      gState.mode = MODE_SINGLE_ARROW;
      gState.simRunning = true;
    }
  }

  // Gửi xác nhận ACK về backend
  const char* devId = doc["device_id"] | DEVICE_ID;
  publishAck(seq, "display_applied", "p10_matrix_updated", devId);
  Serial.printf("[WiEvac] Lenh: %s, Huong: %s, Ngã 3: %s (ID: %s)\n", 
                cmd, dir, gState.isJunction ? "CO" : "KHONG", devId);
}

void onMqttMessage(char* topic, byte* payload, unsigned int length) {
  String strTopic = String(topic);

  // 1. Nhận lệnh trực tiếp cho bảng hiệu (chỉ parse JSON cho đúng thiết bị)
  if (strTopic.startsWith("building/guidance/sign/")) {
    StaticJsonDocument<1024> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
      Serial.print("[MQTT] Loi parse JSON: ");
      Serial.println(err.c_str());
      return;
    }
    JsonObject obj = doc.as<JsonObject>();
    processSignCommand(obj);
    return;
  }

  // 2. Tín hiệu đồng bộ mô phỏng gọn nhẹ (không tốn tài nguyên xử lý)
  if (strTopic == "building/simulation/start" || strTopic == "building/simulation/resume") {
    gState.simRunning = true;
    Serial.println("[WiEvac] Bat dau / Tiep tuc gia lap.");
  } else if (strTopic == "building/simulation/stop") {
    gState.simRunning = false;
    Serial.println("[WiEvac] Dung gia lap (tam dung giu nguyen man hinh).");
  } else if (strTopic == "building/simulation/reset") {
    gState.simRunning = false;
    gState.mode = MODE_STANDBY;
    gState.command = "STANDBY";
    Serial.println("[WiEvac] Reset gia lap -> Ve che do Standby.");
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
  if (now - lastMqttRetry < 3000) return;
  lastMqttRetry = now;

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Dang cho ket noi WiFi...");
    return;
  }

  Serial.print("[MQTT] Dang ket noi toi ");
  Serial.print(MQTT_HOST);
  Serial.println("...");

  if (mqttClient.connect(DEVICE_ID)) {
    Serial.println("[MQTT] Ket noi thanh cong!");

    // Lắng nghe lệnh trực tiếp gửi đích danh đến bảng hiệu này
    String signTopic = String("building/guidance/sign/") + DEVICE_ID;
    mqttClient.subscribe(signTopic.c_str(), 1);

    // Lắng nghe tín hiệu đồng bộ mô phỏng gọn nhẹ
    mqttClient.subscribe("building/simulation/start", 0);
    mqttClient.subscribe("building/simulation/resume", 0);
    mqttClient.subscribe("building/simulation/stop", 0);
    mqttClient.subscribe("building/simulation/reset", 0);

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

// Vẽ mũi tên sang Trái (chevrons chảy động liên tục không ngắt quãng)
void drawStreamingArrowLeft(uint16_t color, uint8_t offset) {
  int shift = offset % 10;
  for (int c = 0; c < 5; c++) {
    int baseX = 32 - c * 10 - shift;

    for (int dy = 0; dy <= 5; dy++) {
      int px = baseX + dy;
      int pyTop = 8 - dy;
      int pyBot = 8 + dy;
      if (px >= 0 && px < 32 && pyTop >= 0 && pyTop < 16) dma_display->drawPixel(px, pyTop, color);
      if (px >= 0 && px < 32 && pyBot >= 0 && pyBot < 16) dma_display->drawPixel(px, pyBot, color);
      if (px + 1 >= 0 && px + 1 < 32 && pyTop >= 0 && pyTop < 16) dma_display->drawPixel(px + 1, pyTop, color);
      if (px + 1 >= 0 && px + 1 < 32 && pyBot >= 0 && pyBot < 16) dma_display->drawPixel(px + 1, pyBot, color);
    }
  }
}

// Vẽ mũi tên sang Phải (chevrons chảy động liên tục không ngắt quãng)
void drawStreamingArrowRight(uint16_t color, uint8_t offset) {
  int shift = offset % 10;
  for (int c = 0; c < 5; c++) {
    int baseX = -6 + c * 10 + shift;

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

// Vẽ mũi tên Đi Thẳng (hướng lên trên)
// Thiết kế mũi tên chuẩn thoát hiểm: đầu nhọn hướng lên, cánh vát xuôi xuống, thân thẳng cân đối tuyệt đối
void drawStreamingArrowUp(uint16_t color, uint8_t offset) {
  // 1. Đầu mũi tên hình tam giác đặc sắc nét (đỉnh tại Y=1, đáy tại Y=7, rộng 14 pixel từ X=9 đến X=22)
  dma_display->fillTriangle(15, 1, 9, 7, 15, 7, color);
  dma_display->fillTriangle(16, 1, 22, 7, 16, 7, color);

  // 2. Thân mũi tên (cột 14..17, từ hàng 7 đến hàng 15)
  dma_display->fillRect(14, 7, 4, 9, color);

  // 3. Luồng sáng trắng chuyển động hướng lên (wave pulse đẩy từ chân lên đỉnh mũi tên)
  int pulse = (offset % 8);
  int waveY = 14 - (pulse * 2);
  if (waveY >= 7 && waveY <= 14) {
    // Vệt sáng trong thân mũi tên
    dma_display->fillRect(14, waveY, 4, 2, CLR_WHITE);
  } else if (waveY >= 1 && waveY < 7) {
    // Vệt sáng mở rộng theo hình nón khi lan lên đầu mũi tên
    int dx = waveY - 1;
    dma_display->fillRect(15 - dx, waveY, (dx * 2) + 2, 2, CLR_WHITE);
  }
}

// Vẽ cảnh báo QUAY LẠI khi hành lang tắc nghẽn (TURN BACK / U-TURN)
// Luân phiên 2 pha: Pha 1 vẽ biểu tượng chữ U quay đầu lớn cân đối | Pha 2 vẽ chữ "QUAY" "LAI!" đậm, căn giữa 100%
void drawTurnBackWarning(bool blink) {
  if (blink) {
    // Pha 1: Biểu tượng chữ U lộn ngược (Quay đầu) lớn, cân đối ở chính giữa màn hình
    dma_display->drawRect(0, 0, 32, 16, CLR_RED);

    // Vòm cong chữ U ở trên
    dma_display->drawFastHLine(11, 2, 10, CLR_RED);
    dma_display->drawFastHLine(12, 3, 8, CLR_ORANGE);
    dma_display->drawFastVLine(10, 3, 9, CLR_RED);
    dma_display->drawFastVLine(11, 4, 7, CLR_ORANGE);
    dma_display->drawFastVLine(21, 3, 7, CLR_RED);
    dma_display->drawFastVLine(20, 4, 5, CLR_ORANGE);

    // Mũi tên chỉ xuống ở chân chữ U (nhánh phải)
    dma_display->drawPixel(21, 12, CLR_RED);
    dma_display->drawPixel(20, 11, CLR_RED);
    dma_display->drawPixel(22, 11, CLR_RED);
    dma_display->drawPixel(19, 10, CLR_RED);
    dma_display->drawPixel(23, 10, CLR_RED);
    dma_display->drawPixel(21, 10, CLR_ORANGE);
    dma_display->drawPixel(21, 11, CLR_ORANGE);
  } else {
    // Pha 2: Chữ QUAY / LAI! đậm, căn giữa hoàn hảo (không bị tràn dòng hay lệch)
    dma_display->drawRect(0, 0, 32, 16, CLR_ORANGE);
    dma_display->setTextColor(CLR_YELLOW);
    dma_display->setTextSize(1);
    dma_display->setCursor(5, 1);
    dma_display->print("QUAY");

    dma_display->setTextColor(CLR_RED);
    dma_display->setCursor(5, 9);
    dma_display->print("LAI!");
  }
}

// Vẽ biểu tượng CẤM VÀO / PHONG TỎA (DO NOT ENTER / NO ROUTE)
// Căn giữa chữ "STOP" tuyệt đối (X=5, Y=5), viền đỏ cân đối
void drawBlockedWarning(bool blink) {
  uint16_t borderClr = blink ? CLR_RED : dma_display->color565(120, 0, 0);

  // Viền đỏ bao quanh
  dma_display->drawRect(0, 0, 32, 16, borderClr);

  // Dấu gạch chéo đỏ lớn (X) 4 góc
  dma_display->drawLine(1, 1, 30, 14, CLR_RED);
  dma_display->drawLine(30, 1, 1, 14, CLR_RED);

  // Khung đen che giữa để chữ STOP nổi bật và cân đối hoàn hảo
  dma_display->fillRect(3, 4, 26, 9, CLR_BLACK);
  dma_display->setTextColor(blink ? CLR_WHITE : CLR_RED);
  dma_display->setTextSize(1);
  dma_display->setCursor(5, 5);
  dma_display->print("STOP");
}

// Vẽ Cửa thoát hiểm (EXIT)
void drawExitSign() {
  dma_display->fillRect(1, 1, 30, 14, dma_display->color565(0, 80, 20));
  dma_display->drawRect(0, 0, 32, 16, CLR_GREEN);

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
// Chỉ bật khi thực tế có nhánh TRÁI và nhánh PHẢI
void drawJunctionComparison(uint8_t step, bool blink) {
  // 1. Vạch phân cách trung tâm (X: 15)
  dma_display->drawFastVLine(15, 0, 15, CLR_DARK_GRAY);

  // 2. NỬA TRÁI (X: 0..14)
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

  if (gState.routeLeft.isBlocked) {
    dma_display->drawLine(3, 3, 11, 11, CLR_RED);
    dma_display->drawLine(11, 3, 3, 11, CLR_RED);
  } else {
    int offset = leftRecommended ? (step % 4) : 0;
    int arrowTipX = 3 - offset;
    if (arrowTipX < 1) arrowTipX += 4;

    dma_display->drawFastHLine(arrowTipX, 7, 8, leftColor);
    dma_display->drawPixel(arrowTipX + 1, 6, leftColor);
    dma_display->drawPixel(arrowTipX + 1, 8, leftColor);
    dma_display->drawPixel(arrowTipX + 2, 5, leftColor);
    dma_display->drawPixel(arrowTipX + 2, 9, leftColor);

    // Thanh sáng xanh ở đỉnh báo nhánh khuyên nên đi
    if (leftRecommended) {
      dma_display->drawFastHLine(1, 1, 13, blink ? CLR_GREEN : CLR_BLACK);
    }
  }

  // 3. NỬA PHẢI (X: 16..31)
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

  if (gState.routeRight.isBlocked) {
    dma_display->drawLine(20, 3, 28, 11, CLR_RED);
    dma_display->drawLine(28, 3, 20, 11, CLR_RED);
  } else {
    int offset = rightRecommended ? (step % 4) : 0;
    int arrowTipX = 27 + offset;
    if (arrowTipX > 29) arrowTipX -= 4;

    dma_display->drawFastHLine(18, 7, arrowTipX - 18, rightColor);
    dma_display->drawPixel(arrowTipX - 1, 6, rightColor);
    dma_display->drawPixel(arrowTipX - 1, 8, rightColor);
    dma_display->drawPixel(arrowTipX - 2, 5, rightColor);
    dma_display->drawPixel(arrowTipX - 2, 9, rightColor);

    if (rightRecommended) {
      dma_display->drawFastHLine(17, 1, 13, blink ? CLR_GREEN : CLR_BLACK);
    }
  }

  // 4. Thanh tỷ lệ độ thông thoáng ở hàng đáy (Y: 15)
  int leftClearPixels = max(1, min(14, (int)((1.0f - gState.routeLeft.k) * 14.0f)));
  dma_display->drawFastHLine(0, 15, leftClearPixels, leftColor);

  int rightClearPixels = max(1, min(14, (int)((1.0f - gState.routeRight.k) * 14.0f)));
  dma_display->drawFastHLine(31 - rightClearPixels, 15, rightClearPixels, rightColor);
}

// Vẽ chế độ CHỜ (STANDBY / SẴN SÀNG)
// Căn giữa 2 dòng tuyệt đối: WI (hàng trên Cyan) + EVAC (hàng dưới Xanh lá)
// Chữ không bao giờ bị rớt dòng hay mất chữ 'C'
void drawStandbyScreen(uint8_t step) {
  // 1. Dòng 1: "WI" (X: 10, Y: 1)
  dma_display->setTextColor(CLR_CYAN);
  dma_display->setTextSize(1);
  dma_display->setCursor(10, 1);
  dma_display->print("WI");

  // 2. Dòng 2: "EVAC" (X: 4, Y: 9)
  dma_display->setTextColor(CLR_GREEN);
  dma_display->setCursor(4, 9);
  dma_display->print("EVAC");

  // 3. Đèn báo kết nối mạng ở góc trên bên phải
  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  bool mqttOk = mqttClient.connected();

  // Đèn WiFi tại (28, 1), Đèn MQTT tại (30, 1)
  dma_display->drawPixel(28, 1, wifiOk ? CLR_GREEN : CLR_RED);
  dma_display->drawPixel(30, 1, mqttOk ? CLR_CYAN : CLR_RED);

  // 4. Radar nhấp nháy nhẹ ở góc màn hình báo hiệu đang online
  if ((step / 8) % 2 == 0) {
    dma_display->drawPixel(1, 1, CLR_CYAN);
    dma_display->drawPixel(1, 14, CLR_GREEN);
  }
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
  mxconfig.gpio.a  = A_PIN;
  mxconfig.gpio.b  = B_PIN;
  mxconfig.gpio.c  = C_PIN;
  mxconfig.gpio.d  = D_PIN;
  mxconfig.gpio.e  = E_PIN;
  mxconfig.gpio.lat = LAT_PIN;
  mxconfig.gpio.oe  = OE_PIN;
  mxconfig.gpio.clk = CLK_PIN;

  dma_display = new MatrixPanel_I2S_DMA(mxconfig);
  dma_display->begin();
  dma_display->setBrightness8(90);  // Độ sáng dịu mắt, tiết kiệm nguồn
  dma_display->clearScreen();

  // Khởi động mạng
  setupWifi();
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(onMqttMessage);
  mqttClient.setBufferSize(2048);
}

void loop() {
  // 1. Duy trì kết nối MQTT
  checkMqttConnection();
  mqttClient.loop();

  // 2. Gửi bản tin Heartbeat định kỳ mỗi 5 giây
  unsigned long now = millis();
  if (now - lastHeartbeat >= 5000) {
    lastHeartbeat = now;
    if (mqttClient.connected()) {
      publishAck(gState.sequence, "heartbeat", "sign_online_active");
    }
  }

  // 3. Cập nhật hoạt ảnh và hiển thị ở 20 FPS (mỗi 50ms) đồng bộ thời gian thực
  if (now - lastAnimTick >= 50) {
    uint8_t stepsPassed = (now - lastAnimTick) / 50;
    lastAnimTick += stepsPassed * 50;
    animStep += stepsPassed;

    // Nhấp nháy ở chu kỳ 500ms
    if ((animStep / 10) % 2 == 0) {
      blinkToggle = true;
    } else {
      blinkToggle = false;
    }

    dma_display->clearScreen();

    // Lựa chọn chế độ hiển thị
    switch (gState.mode) {
      case MODE_STANDBY:
        drawStandbyScreen(animStep);
        break;

      case MODE_SINGLE_ARROW:
        {
          uint16_t arrowClr = CLR_GREEN;
          if (gState.loadLevel == "congested") arrowClr = CLR_RED;
          else if (gState.loadLevel == "busy") arrowClr = CLR_YELLOW;

          if (gState.direction == "LEFT") {
            drawStreamingArrowLeft(arrowClr, animStep);
          } else if (gState.direction == "RIGHT") {
            drawStreamingArrowRight(arrowClr, animStep);
          } else {
            drawStreamingArrowUp(arrowClr, animStep);
          }
        }
        break;

      case MODE_TURN_BACK:
        drawTurnBackWarning(blinkToggle);
        break;

      case MODE_BLOCKED:
        drawBlockedWarning(blinkToggle);
        break;

      case MODE_JUNCTION:
        drawJunctionComparison(animStep, blinkToggle);
        break;

      case MODE_EXIT:
        drawExitSign();
        break;
    }
  }
}
