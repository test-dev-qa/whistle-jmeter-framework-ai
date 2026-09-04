<#
提交并推送报告详情、响应时间筛选与部署文档相关改动。

用法：
  .\scripts\commit-and-push.ps1
  .\scripts\commit-and-push.ps1 -Message "feat: your message"
#>
[CmdletBinding()]
param(
    [string]$Message = 'feat: improve report details and response time filter'
)

$ErrorActionPreference = 'Stop'

function Invoke-Git {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    & git @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "git $($Arguments -join ' ') failed (exit code $LASTEXITCODE)."
    }
}

$branch = (& git branch --show-current).Trim()
if ([string]::IsNullOrWhiteSpace($branch)) {
    throw '无法推送：当前 HEAD 处于 detached 状态。'
}

# 仅允许快进更新，避免脚本隐式制造 merge commit。
Invoke-Git @('pull', '--ff-only', 'origin', $branch)

# 显式白名单：不把工作区其他未关联改动带入提交。
$files = @(
    'DEPLOY.md',
    'lib/stressReportStore.js',
    'lib/stressTest.js',
    'test/stressReportStore.test.js',
    'ui/index.html',
    'ui/records-core-ui.js',
    'ui/stress-ui.js',
    'scripts/commit-and-push.ps1'
)

Invoke-Git (@('add', '--') + $files)

& git diff --cached --quiet
if ($LASTEXITCODE -eq 0) {
    Write-Host '没有白名单内的待提交改动。'
    Invoke-Git @('push', 'origin', $branch)
    exit 0
}
if ($LASTEXITCODE -ne 1) {
    throw '无法检查暂存区状态。'
}

Invoke-Git @('diff', '--cached', '--check')
Invoke-Git @('commit', '-m', $Message)
Invoke-Git @('push', 'origin', $branch)

Write-Host "已推送 $branch 到 origin。"
