#!/bin/bash
cd "$(dirname "$0")" || exit 1
source .venv/bin/activate
export WRITECLAW_DEBUG="1" 
python -m app.main
