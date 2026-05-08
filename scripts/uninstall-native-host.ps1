param(
  [string]$HostName = "com.codex.edge_bridge"
)

$ErrorActionPreference = "Stop"

$registryPath = "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
if (Test-Path $registryPath) {
  Remove-Item -LiteralPath $registryPath -Force
  Write-Host "Removed native host registration: $HostName"
} else {
  Write-Host "Native host registration was not found: $HostName"
}
