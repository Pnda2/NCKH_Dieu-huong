#include "Arduino.h"
#include "DFRobotDFPlayerMini.h"

// Chuyển sang cặp chân mới hoàn toàn trống
#define PIN_RX 2  // ESP32 Nhận (Nối chân TX của MP3)
#define PIN_TX 1  // ESP32 Truyền (Nối qua trở 1k vào chân RX của MP3)

HardwareSerial mp3Serial(1);
DFRobotDFPlayerMini myDFPlayer;

void setup() {
  Serial.begin(115200);
  delay(1000);

  // Khởi tạo UART với RX = 2, TX = 1
  mp3Serial.begin(9600, SERIAL_8N1, PIN_RX, PIN_TX);

  // Bỏ qua cờ ACK để tương thích chip clone
  myDFPlayer.begin(mp3Serial, false, false);
  delay(500);

  myDFPlayer.volume(25);
  delay(300);

  Serial.println("Dang phat file /mp3/0100.mp3...");
  myDFPlayer.playMp3Folder(100); 
}

void loop() {
}