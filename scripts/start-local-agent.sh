#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

export WORKSPACE_DIR="${WORKSPACE_DIR:-$PROJECT_DIR}"
export MODEL_BASE_URL="${MODEL_BASE_URL:-http://127.0.0.1:8080/v1}"

if [ ! -d "$PROJECT_DIR/node_modules" ]; then
  echo "Installing app dependencies..."
  npm install
fi

echo "Workspace: $WORKSPACE_DIR"
echo "Model API: $MODEL_BASE_URL"
echo "Opening Local Agent Studio..."
npm run dev
