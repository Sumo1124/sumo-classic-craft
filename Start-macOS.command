#!/bin/sh
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 or newer is required. Install it from https://nodejs.org and retry."
  read -r _
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  npm install || exit 1
fi

( sleep 6; open "http://127.0.0.1:8788/" ) &
echo "Sumo Classic Craft - World of CarrickCraft is starting at http://127.0.0.1:8788/ (Ctrl+C to stop)"
npm start
