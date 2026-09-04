Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
node scripts/run-unit-tests-report.js
exit $LASTEXITCODE
