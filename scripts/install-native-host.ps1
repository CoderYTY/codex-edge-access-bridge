param(
  [string]$ExtensionId = "hoknjjaaoakpcokjenclbkbemconlmnn",
  [string]$HostName = "com.codex.edge_bridge",
  [string]$NodePath = "",
  [int]$Port = 18888
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $PSCommandPath)
$nativeDir = Join-Path $root "native"
$launcherSource = Join-Path $nativeDir "NativeHostLauncher.cs"
$launcherExe = Join-Path $nativeDir "edge-codex-native-host-v2.exe"
$nodePathFile = Join-Path $nativeDir "node-path.txt"
$manifestPath = Join-Path $nativeDir "$HostName.json"

if (-not (Test-Path $nativeDir)) {
  New-Item -ItemType Directory -Path $nativeDir | Out-Null
}

if (-not $NodePath) {
  $nodeCommand = Get-Command node.exe -ErrorAction Stop
  $NodePath = $nodeCommand.Source
}

if (-not (Test-Path $NodePath)) {
  throw "Node was not found at: $NodePath"
}

$csc = Join-Path $env:WINDIR "Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = Join-Path $env:WINDIR "Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
  throw "Could not find csc.exe. Install .NET Framework developer tools or use the manual bridge."
}

$needsBuild = -not (Test-Path $launcherExe)
if (-not $needsBuild) {
  $needsBuild = (Get-Item $launcherSource).LastWriteTimeUtc -gt (Get-Item $launcherExe).LastWriteTimeUtc
}

if ($needsBuild) {
  & $csc /nologo /target:exe /platform:anycpu /out:$launcherExe $launcherSource
}

$utf8NoBom = New-Object System.Text.UTF8Encoding -ArgumentList $false
[System.IO.File]::WriteAllText($nodePathFile, $NodePath, $utf8NoBom)

$manifest = [ordered]@{
  name = $HostName
  description = "Codex Edge Access Native Messaging Host"
  path = $launcherExe
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}

$manifestJson = $manifest | ConvertTo-Json -Depth 5
[System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)

$registryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
if (-not (Test-Path $registryPath)) {
  New-Item -Path $registryPath -Force | Out-Null
}
Set-Item -Path $registryPath -Value $manifestPath

Write-Host "Native host installed."
Write-Host "Host name: $HostName"
Write-Host "Extension ID: $ExtensionId"
Write-Host "Manifest: $manifestPath"
Write-Host "Launcher: $launcherExe"
Write-Host "Node: $NodePath"
Write-Host "CLI URL: http://127.0.0.1:$Port"
Write-Host ""
Write-Host "Reload the Edge extension, then open the Codex Edge Bridge dashboard."
