#!/usr/bin/env sh
# Commit and push only the reporting/filter/deployment-documentation changes.
# 在 Git Bash / WSL / macOS / Linux 中执行：sh scripts/commit-and-push.sh "feat: your message"
set -eu

git pull

branch="$(git branch --show-current)"
if [ -z "$branch" ]; then
  echo "Cannot push: HEAD is detached." >&2
  exit 1
fi

git add -- \
  DEPLOY.md \
  lib/stressReportStore.js \
  lib/stressTest.js \
  test/stressReportStore.test.js \
  ui/index.html \
  ui/records-core-ui.js \
  ui/stress-ui.js \
  scripts/commit-and-push.sh

git commit -m "${1:-feat: improve report details and response time filter}"
git push origin "$branch"

echo "Pushed ${branch} to origin."
