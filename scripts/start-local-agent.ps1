$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent $PSScriptRoot
Set-Location $projectDir

if (-not $env:WORKSPACE_DIR) { $env:WORKSPACE_DIR = $projectDir }
if (-not $env:MODEL_BASE_URL) { $env:MODEL_BASE_URL = 'http://127.0.0.1:8080/v1' }

if (-not (Test-Path (Join-Path $projectDir 'node_modules'))) {
    Write-Host 'Installing app dependencies...'
    npm install
}

Write-Host "Workspace: $env:WORKSPACE_DIR"
Write-Host "Model API: $env:MODEL_BASE_URL"
Write-Host 'Opening Local Agent Studio...'
npm run dev
