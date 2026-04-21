#!/bin/bash
# Auto Darkwar - Run on Desktop Display
# Chạy với display thật để thấy Chrome

export DISPLAY=:1
export XAUTHORITY=/run/user/1000/.mutter-Xwaylandauth.SYRVN3
export DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus
export XDG_RUNTIME_DIR=/run/user/1000

cd /home/nvsang/server/auto-tool
node open-browser.js


#chmod +x browser.sh