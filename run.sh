#!/bin/bash
cd "$(dirname "$0")" || exit 1
source .venv/bin/activate
export DEEPSEEKWRITE_DEBUG="1"
python -m app.main
