import paho.mqtt.client as mqtt
import time
import sys

def on_connect(c, u, f, r):
    print("Connected v1!", r)
    sys.stdout.flush()

c = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
c.on_connect = on_connect
c.connect("127.0.0.1", 1883, 60)
c.loop_start()

time.sleep(2)
