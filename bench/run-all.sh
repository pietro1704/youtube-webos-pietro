#!/usr/bin/env bash
# Objective verification only. Informational measurements: npm run bench:metrics.
set -euo pipefail
cd "$(dirname "$0")/.."
npm run lint
npm run type-check
npm test
npm run test:perf
npm run build:modern
npm run test:modern
npm run test:perf:modern
npm run test:native-audio-browser
npm run build
