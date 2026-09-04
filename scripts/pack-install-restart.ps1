Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
node scripts/pack-install-restart.js
exit $LASTEXITCODE
