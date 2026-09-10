# ESP32 guidance firmware sample

This PlatformIO sample consumes the retained WiEvac MQTT guidance payload,
shows its `presentation.visual_intent` on a MAX7219 chain and maps
`audio_clip_id` to DFPlayer `/MP3/0001.mp3` style tracks. DFPlayer audio feeds
PAM8403, which drives the speaker.

Copy `include/device_config.example.h` to `include/device_config.h`, set local
network values, then run `pio run --target upload`. The local config is ignored
and must never be committed. The device publishes capability and ACK messages,
and returns to STANDBY after `valid_until`.
