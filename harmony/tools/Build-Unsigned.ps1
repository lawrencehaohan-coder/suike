[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$CommandLineToolsRoot,
  [Parameter(Mandatory = $true)][string]$JavaHome,
  [string]$BuildDirectory = '',
  [string]$ToolCacheDirectory = '',
  [switch]$NoToolLinks
)
$ErrorActionPreference = 'Stop'
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$cliRoot = (Resolve-Path -LiteralPath $CommandLineToolsRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $cliRoot 'bin\hvigorw.bat')) -and
    (Test-Path -LiteralPath (Join-Path $cliRoot 'command-line-tools\bin\hvigorw.bat'))) {
  $cliRoot = Join-Path $cliRoot 'command-line-tools'
}
$javaRoot = (Resolve-Path -LiteralPath $JavaHome).Path
$nodeRoot = Join-Path $cliRoot 'tool\node'
$sdkRoot = Join-Path $cliRoot 'sdk'
$ohpm = Join-Path $cliRoot 'bin\ohpm.bat'
$hvigor = Join-Path $cliRoot 'bin\hvigorw.bat'
foreach ($file in @((Join-Path $javaRoot 'bin\java.exe'), (Join-Path $nodeRoot 'node.exe'), $ohpm, $hvigor, (Join-Path $sdkRoot 'default\sdk-pkg.json'))) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Required official build component is missing: $file" }
}
$sdkMetadata = Get-Content -LiteralPath (Join-Path $sdkRoot 'default\sdk-pkg.json') -Raw | ConvertFrom-Json
if ($sdkMetadata.data.apiVersion -ne '20') { throw 'This source release was verified with the official HarmonyOS API 20 SDK. Supply its matching CLI package.' }
$profile = Get-Content -LiteralPath (Join-Path $sourceRoot 'build-profile.json5') -Raw
if ($profile -match '[''"]signingConfigs?[''"]\s*:') { throw 'The unsigned build helper refuses projects containing signing configuration.' }
if (-not $BuildDirectory) { $BuildDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('suike-harmony-build-' + [Guid]::NewGuid().ToString('N')) }
$buildRoot = [System.IO.Path]::GetFullPath($BuildDirectory)
if ($buildRoot.Equals($sourceRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $buildRoot.StartsWith($sourceRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'BuildDirectory must be outside the source directory.'
}
if (Test-Path -LiteralPath $buildRoot) { throw 'BuildDirectory already exists. Supply a new empty destination path.' }
New-Item -ItemType Directory -Path $buildRoot | Out-Null
$buildProject = Join-Path $buildRoot 'project'
Copy-Item -LiteralPath $sourceRoot -Destination $buildProject -Recurse
$cacheRoot = if ($ToolCacheDirectory) { [System.IO.Path]::GetFullPath($ToolCacheDirectory) } else { Join-Path $buildRoot 'cache' }
if ($cacheRoot.Equals($sourceRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $cacheRoot.StartsWith($sourceRoot + [System.IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'ToolCacheDirectory must be outside the source directory.'
}
$environmentNames = @('JAVA_HOME', 'NODE_HOME', 'DEVECO_NODE_HOME', 'DEVECO_SDK_HOME', 'HVIGOR_USER_HOME', 'OHPM_USER_HOME', 'NPM_CONFIG_CACHE', 'PNPM_HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'Path')
$previousEnvironment = @{}
foreach ($name in $environmentNames) { $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
Push-Location -LiteralPath $buildProject
try {
  $env:JAVA_HOME = $javaRoot
  $env:NODE_HOME = $nodeRoot
  $env:DEVECO_NODE_HOME = $nodeRoot
  $env:DEVECO_SDK_HOME = $sdkRoot
  $env:HVIGOR_USER_HOME = Join-Path $cacheRoot 'hvigor-cache'
  $env:OHPM_USER_HOME = Join-Path $cacheRoot 'ohpm-cache'
  $env:NPM_CONFIG_CACHE = Join-Path $cacheRoot 'npm-cache'
  $env:USERPROFILE = Join-Path $cacheRoot 'tool-user'
  $env:APPDATA = Join-Path $env:USERPROFILE 'AppData\Roaming'
  $env:LOCALAPPDATA = Join-Path $env:USERPROFILE 'AppData\Local'
  $env:PNPM_HOME = Join-Path $env:USERPROFILE 'pnpm'
  $env:TEMP = Join-Path $cacheRoot 'tmp'
  $env:TMP = $env:TEMP
  New-Item -ItemType Directory -Path $env:USERPROFILE,$env:APPDATA,$env:LOCALAPPDATA,$env:PNPM_HOME,$env:TEMP -Force | Out-Null
  $env:Path = "$nodeRoot;$javaRoot\bin;$env:Path"
  if ($NoToolLinks) {
    # The official wrapper supports explicit file dependencies. Bind its bundled
    # packages in this build copy and provide ordinary directories instead of
    # creating Windows junctions, which some restricted environments disallow.
    $configPath = Join-Path $buildProject 'hvigor\hvigor-config.json5'
    $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    $dependencies = [ordered]@{}
    $cacheDependencies = [ordered]@{}
    $md5 = [System.Security.Cryptography.MD5]::Create()
    try { $projectHash = [BitConverter]::ToString($md5.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($buildProject))).Replace('-', '').ToLowerInvariant() }
    finally { $md5.Dispose() }
    $dependencyWorkspace = Join-Path $env:HVIGOR_USER_HOME "project_caches\$projectHash\workspace"
    foreach ($packageName in @('hvigor', 'hvigor-ohos-plugin')) {
      $packageSource = Join-Path $cliRoot "hvigor\$packageName"
      if (-not (Test-Path -LiteralPath (Join-Path $packageSource 'package.json'))) { throw "Missing bundled build package: $packageSource" }
      $dependencies["@ohos/$packageName"] = "file:$packageSource"
      $cacheDependencies["@ohos/$packageName"] = $packageSource
      $packageDestination = Join-Path $dependencyWorkspace "node_modules\@ohos\$packageName"
      if (Test-Path -LiteralPath $packageDestination) { throw 'NoToolLinks requires a new build directory with a new dependency workspace.' }
      New-Item -ItemType Directory -Path (Split-Path -Parent $packageDestination) -Force | Out-Null
      Copy-Item -LiteralPath $packageSource -Destination $packageDestination -Recurse
    }
    $config.dependencies = $dependencies
    $config | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $configPath -Encoding utf8
    @{ dependencies = $cacheDependencies } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $dependencyWorkspace 'package.json') -Encoding utf8
    @{ sourceConfigurationUnchanged = $true; buildCopyConfiguration = $configPath; officialPackages = $cacheDependencies; dependencyWorkspace = $dependencyWorkspace } | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath (Join-Path $buildRoot 'tool-bindings.json') -Encoding utf8
  }
  $ErrorActionPreference = 'Continue'
  & $ohpm install 2>&1 | Tee-Object -LiteralPath (Join-Path $buildRoot 'ohpm.log')
  if ($LASTEXITCODE -ne 0) { throw 'ohpm install failed; see ohpm.log.' }
  & $hvigor --mode module -p product=default -p module=entry@default -p buildMode=debug assembleHap --no-daemon 2>&1 | Tee-Object -LiteralPath (Join-Path $buildRoot 'build.log')
  if ($LASTEXITCODE -ne 0) { throw 'Hvigor compilation failed; see build.log and project/.hvigor/outputs/build-logs/build.log.' }
} finally {
  $ErrorActionPreference = 'Stop'
  Pop-Location
  foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process') }
}
$hap = Join-Path $buildProject 'entry\build\default\outputs\default\entry-default-unsigned.hap'
if (-not (Test-Path -LiteralPath $hap -PathType Leaf)) { throw 'No unsigned HAP was generated; do not treat this run as a completed build.' }
Get-FileHash -LiteralPath $hap -Algorithm SHA256 | Format-List
Write-Output "Unsigned HAP: $hap"
Write-Output "Build directory: $buildRoot"
Write-Output "Tool cache directory: $cacheRoot"
