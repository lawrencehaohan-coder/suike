[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$CommandLineToolsRoot)
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$cliRoot = (Resolve-Path -LiteralPath $CommandLineToolsRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $cliRoot 'tool\node\node.exe')) -and
    (Test-Path -LiteralPath (Join-Path $cliRoot 'command-line-tools\tool\node\node.exe'))) {
  $cliRoot = Join-Path $cliRoot 'command-line-tools'
}
$node = Join-Path $cliRoot 'tool\node\node.exe'
$typescriptRoot = Join-Path $cliRoot 'hvigor\hvigor\node_modules\typescript'
if (-not (Test-Path -LiteralPath $node) -or -not (Test-Path -LiteralPath (Join-Path $typescriptRoot 'package.json'))) {
  throw 'Supply the complete official CLI 6.0.0.878 directory, including its Node and TypeScript runtime.'
}
$previousHarmonyTs = [Environment]::GetEnvironmentVariable('HARMONY_TYPESCRIPT', 'Process')
$previousSuikeTs = [Environment]::GetEnvironmentVariable('SUIKE_TYPESCRIPT', 'Process')
Push-Location -LiteralPath $projectRoot
try {
  $env:HARMONY_TYPESCRIPT = $typescriptRoot
  $env:SUIKE_TYPESCRIPT = $typescriptRoot
  $testFiles = @(Get-ChildItem -LiteralPath (Join-Path $projectRoot 'tests') -Filter '*.test.cjs' -File | Sort-Object Name | ForEach-Object FullName)
  & $node --test @testFiles
  if ($LASTEXITCODE -ne 0) { throw 'Native behavior mock tests failed.' }
} finally {
  Pop-Location
  [Environment]::SetEnvironmentVariable('HARMONY_TYPESCRIPT', $previousHarmonyTs, 'Process')
  [Environment]::SetEnvironmentVariable('SUIKE_TYPESCRIPT', $previousSuikeTs, 'Process')
}
