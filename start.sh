#!/bin/sh
# RadioPlayer - pokretanje na Linuxu/macOS-u (treba Node.js 18 ili noviji)
cd "$(dirname "$0")" || exit 1
exec node server.js --open
