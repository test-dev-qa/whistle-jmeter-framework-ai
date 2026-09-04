#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/run-unit-tests-report.js
