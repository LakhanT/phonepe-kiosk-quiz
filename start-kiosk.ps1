$ErrorActionPreference = "Stop"

$port = 5173
Write-Host "Starting local server on port $port..."

Start-Process -WindowStyle Hidden -FilePath "python" -ArgumentList @("-m", "http.server", "$port")
Start-Sleep -Milliseconds 600

$url = "http://localhost:$port/?kiosk=1"

Write-Host "Launching Edge in kiosk mode: $url"

$edge1 = "$env:ProgramFiles(x86)\Microsoft\Edge\Application\msedge.exe"
$edge2 = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"

$edge = (Test-Path $edge1) ? $edge1 : $edge2
if (!(Test-Path $edge)) {
  Write-Host "Edge not found. Open this URL in your kiosk browser: $url"
  exit 0
}

Start-Process -FilePath $edge -ArgumentList @("--kiosk", $url)

