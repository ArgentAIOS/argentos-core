param(
  [string]$Version = "latest",
  [switch]$NoOnboard
)

$ErrorActionPreference = "Stop"

function Fail($Message) {
  Write-Error $Message
  exit 1
}

function Require-Command($Name) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    Fail "$Name is required. Install Node.js 22+ and reopen PowerShell."
  }
}

Require-Command "node"
Require-Command "npm"

$nodeVersion = (& node -p "process.versions.node").Trim()
if (-not $nodeVersion) {
  Fail "Unable to determine Node.js version."
}

$major = [int]($nodeVersion.Split('.')[0])
if ($major -lt 22) {
  Fail "Node.js 22+ is required. Current version: $nodeVersion"
}

$packageSpec = if ($Version -eq "latest") { "argentos@latest" } else { "argentos@$Version" }
Write-Host "Installing $packageSpec globally..."
& npm install -g $packageSpec
if ($LASTEXITCODE -ne 0) {
  Fail "npm install failed."
}

if (-not $NoOnboard) {
  Write-Host "Running onboarding..."
  & argent onboard --install-daemon
}

Write-Host "Installed argent CLI."
