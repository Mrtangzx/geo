[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This optional native fallback is for Windows.' }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$dataDir = Join-Path $projectRoot '.local/postgres-data-17'
$pgCtl = Join-Path $env:LOCALAPPDATA 'Codex/geo-skills/postgres-17.11/package/native/bin/pg_ctl.exe'
if (-not (Test-Path -LiteralPath $pgCtl -PathType Leaf)) { throw 'Native PostgreSQL binaries are not installed.' }
if (-not (Test-Path -LiteralPath (Join-Path $dataDir 'PG_VERSION') -PathType Leaf)) { throw 'No native PostgreSQL cluster exists for this project.' }
& $pgCtl -D $dataDir -m fast -w -t 45 stop
if ($LASTEXITCODE -ne 0) { throw 'Could not stop the project native PostgreSQL cluster.' }
Write-Output 'Project native PostgreSQL stopped; data was retained.'
