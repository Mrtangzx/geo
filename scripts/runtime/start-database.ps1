[CmdletBinding()]
param(
    [string]$DockerContext = ''
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$envPath = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw 'Missing .env.local. Run scripts/runtime/setup-local.ps1 first.'
}

$contextArgs = @()
if ($DockerContext) { $contextArgs = @('--context', $DockerContext) }
& docker @contextArgs version --format '{{.Server.Version}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker daemon is unavailable. Start Docker Desktop, then retry.' }

& docker @contextArgs compose --project-directory $projectRoot --env-file $envPath -f (Join-Path $projectRoot 'compose.yaml') up -d --wait postgres
if ($LASTEXITCODE -ne 0) { throw 'Database startup or health check failed. Existing data was retained.' }

& docker @contextArgs compose --project-directory $projectRoot --env-file $envPath -f (Join-Path $projectRoot 'compose.yaml') ps postgres
if ($LASTEXITCODE -ne 0) { throw 'Could not read database service status.' }
