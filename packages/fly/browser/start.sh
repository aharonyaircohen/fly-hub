#!/bin/sh
set -eu

if [ -f /etc/kody-ssh/start.sh ]; then
  sh /etc/kody-ssh/start.sh
fi

export DISPLAY=:99
# Fly can preserve /tmp while replacing a Machine image. Remove only this
# browser's stale display artifacts before starting its new X server.
rm -f /tmp/.X99-lock /tmp/.X11-unix/X99
Xvfb "$DISPLAY" -screen 0 1440x900x24 -nolisten tcp >/tmp/xvfb.log 2>&1 &

for _attempt in $(seq 1 100); do
  [ -S /tmp/.X11-unix/X99 ] && break
  sleep 0.1
done
[ -S /tmp/.X11-unix/X99 ]

fluxbox >/tmp/fluxbox.log 2>&1 &
x11vnc -display "$DISPLAY" -localhost -forever -shared -nopw >/tmp/x11vnc.log 2>&1 &

chromium \
  --no-sandbox \
  --disable-dev-shm-usage \
  --disable-background-networking \
  --disable-default-apps \
  --disable-sync \
  --no-first-run \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="${KODY_BROWSER_PROFILE_DIR:-/home/browser/profile}" \
  --window-position=0,0 \
  --window-size=1440,900 \
  about:blank >/tmp/chromium.log 2>&1 &

exec ./node_modules/.bin/tsx /app/server.ts
