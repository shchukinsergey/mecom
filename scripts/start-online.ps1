param(
  [switch]$LocalOnly,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Cloudflared = Get-Command cloudflared -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $Cloudflared) {
  $LocalCopy = Join-Path $env:LOCALAPPDATA 'MECOM\tools\cloudflared.exe'
  if (Test-Path $LocalCopy) { $Cloudflared = $LocalCopy }
}
if ($LocalOnly) { $Cloudflared = $null }
if (-not $Cloudflared) {
  Write-Warning 'cloudflared was not found; starting in local-only mode.'
}

$ConfigPaths = @(
  (Join-Path $env:USERPROFILE '.cloudflared\config.yml'),
  (Join-Path $env:USERPROFILE '.cloudflared\config.yaml')
)
$ExistingConfig = $ConfigPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($ExistingConfig) {
  Write-Warning 'A cloudflared config already exists; leaving it untouched and starting in local-only mode.'
  $Cloudflared = $null
}

$Random = [byte[]]::new(32)
$Generator = [Security.Cryptography.RandomNumberGenerator]::Create()
try { $Generator.GetBytes($Random) } finally { $Generator.Dispose() }
$AdminToken = [Convert]::ToBase64String($Random).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$Random = $null
$Port = 8787
while ($true) {
  $Probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
  try { $Probe.Start(); $Probe.Stop(); break }
  catch { try { $Probe.Stop() } catch { }; $Port++ }
}
$LocalBase = "http://127.0.0.1:$Port"

$Server = $null
$Tunnel = $null
$Logs = Join-Path $env:LOCALAPPDATA 'MECOM\logs'
New-Item -ItemType Directory -Force -Path $Logs | Out-Null
$RunId = [guid]::NewGuid().ToString('N')
$ServerOut = Join-Path $Logs "server-$RunId.out.log"
$ServerErr = Join-Path $Logs "server-$RunId.err.log"
$TunnelOut = Join-Path $Logs "quick-tunnel-$RunId.log"
$TunnelErr = Join-Path $Logs "quick-tunnel-$RunId.err.log"

try {
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw "Production build failed with exit code $LASTEXITCODE." }

  $env:MECOM_ADMIN_TOKEN = $AdminToken
  $env:MECOM_SERVER_PORT = [string]$Port
  $env:MECOM_MODE = 'legacy'
  try { $Server = Start-Process -FilePath 'node.exe' -ArgumentList @('dist-server/index.js') -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden -RedirectStandardOutput $ServerOut -RedirectStandardError $ServerErr }
  finally { Remove-Item Env:MECOM_ADMIN_TOKEN, Env:MECOM_SERVER_PORT, Env:MECOM_MODE -ErrorAction SilentlyContinue }
  $Healthy = $false
  for ($i = 0; $i -lt 45; $i++) {
    $Server.Refresh()
    if ($Server.HasExited) { throw "MECOM server exited. See $ServerErr" }
    try {
      $Response = Invoke-WebRequest -UseBasicParsing -Uri "$LocalBase/health" -TimeoutSec 2
      if ($Response.StatusCode -eq 200) { $Healthy = $true; break }
    } catch { }
    Start-Sleep -Seconds 1
  }
  if (-not $Healthy) { throw "MECOM server did not answer /health. See $ServerErr" }

  $PublicUrl = ''
  $PublicHealthy = $false
  if ($Cloudflared) {
    $Tunnel = Start-Process -FilePath $Cloudflared -ArgumentList @('tunnel', '--protocol', 'http2', '--url', $LocalBase) -PassThru -WindowStyle Hidden -RedirectStandardOutput $TunnelOut -RedirectStandardError $TunnelErr
    for ($i = 0; $i -lt 60; $i++) {
      $Tunnel.Refresh()
      if ($Tunnel.HasExited) { Write-Warning "cloudflared exited. See $TunnelOut and $TunnelErr"; break }
      if ((Test-Path $TunnelOut) -or (Test-Path $TunnelErr)) {
        $TunnelLog = (Get-Content -Raw $TunnelOut -ErrorAction SilentlyContinue) + (Get-Content -Raw $TunnelErr -ErrorAction SilentlyContinue)
        $Match = [regex]::Match($TunnelLog, 'https://[a-z0-9-]+\.trycloudflare\.com')
        if ($Match.Success -and $TunnelLog -match 'Registered tunnel connection') { $PublicUrl = $Match.Value; break }
      }
      Start-Sleep -Seconds 1
    }
    if (-not $PublicUrl) { Write-Warning 'No public address received; continuing in local-only mode.' }
    if ($PublicUrl) {
      for ($i = 0; $i -lt 30; $i++) {
        try {
          $Response = Invoke-WebRequest -UseBasicParsing -Uri "$PublicUrl/health" -TimeoutSec 5
          if ($Response.StatusCode -eq 200) { $PublicHealthy = $true; break }
        } catch { }
        Start-Sleep -Seconds 1
      }
    }
    if (-not $PublicHealthy) { Write-Warning 'Public connection check failed; the game is available only on this computer.' }
  } else {
    Write-Warning 'Remote connection is not configured; the game is available only on this computer.'
  }

  $PlayerOrigin = if ($PublicHealthy) { $PublicUrl } else { $LocalBase }
  $AdminUrl = "$LocalBase/?publicOrigin=$([uri]::EscapeDataString($PlayerOrigin))#manage/$AdminToken"
  if (-not $NoBrowser) { Start-Process $AdminUrl }

  Write-Host ''
  if ($PublicHealthy) { Write-Host "Players connect at: $PublicUrl" -ForegroundColor Green }
  else { Write-Host "Local admin page: $LocalBase" -ForegroundColor Yellow }
  Write-Host 'Share only the player invitation from the admin page. Keep this window open; Ctrl+C stops the game.'
  Write-Host "Logs: $Logs"
  while (-not $Server.HasExited -and ($null -eq $Tunnel -or -not $Tunnel.HasExited)) { Start-Sleep -Seconds 2; $Server.Refresh(); if ($Tunnel) { $Tunnel.Refresh() } }
  if ($Server.HasExited) { throw "MECOM server stopped. See $ServerErr" }
} finally {
  if ($Tunnel -and -not $Tunnel.HasExited) { Stop-Process -Id $Tunnel.Id -Force -ErrorAction SilentlyContinue }
  if ($Server -and -not $Server.HasExited) { Stop-Process -Id $Server.Id -Force -ErrorAction SilentlyContinue }
  Remove-Item Env:MECOM_ADMIN_TOKEN -ErrorAction SilentlyContinue
  Remove-Item Env:MECOM_SERVER_PORT -ErrorAction SilentlyContinue
  Remove-Variable AdminToken -ErrorAction SilentlyContinue
}
