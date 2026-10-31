[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'This optional native fallback is for Windows. Use Compose on other systems.' }
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$envPath = Join-Path $projectRoot '.env.local'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) { throw 'Run scripts/runtime/setup-local.ps1 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'node_modules/pg/package.json'))) { throw 'Install application dependencies before starting the native fallback.' }

$localConfig = @{}
foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match '^([A-Z_]+)=(.*)$') { $localConfig[$Matches[1]] = $Matches[2] }
}
if ($localConfig.POSTGRES_HOST -ne '127.0.0.1') { throw 'Native fallback is restricted to 127.0.0.1.' }
if (-not $localConfig.POSTGRES_PASSWORD -or -not $localConfig.POSTGRES_USER) { throw 'Missing local PostgreSQL credentials.' }
$port = [int]$localConfig.POSTGRES_PORT
if ($port -lt 1024 -or $port -gt 65535) { throw 'Invalid local PostgreSQL port.' }

$cacheRoot = Join-Path $env:LOCALAPPDATA 'Codex/geo-skills/postgres-17.11'
$binDir = Join-Path $cacheRoot 'package/native/bin'
$postgres = Join-Path $binDir 'postgres.exe'
$pgCtl = Join-Path $binDir 'pg_ctl.exe'
$initDb = Join-Path $binDir 'initdb.exe'
if (-not (Test-Path -LiteralPath $postgres -PathType Leaf)) {
    New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
    $packageInfo = npm pack '@embedded-postgres/windows-x64@17.11.0-beta.19' --pack-destination $cacheRoot --json --registry=https://registry.npmjs.org | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL binary download failed.' }
    $archivePath = Join-Path $cacheRoot $packageInfo.filename
    $archiveEntries = @(tar -tf $archivePath)
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect PostgreSQL binary archive.' }
    if (@($archiveEntries | Where-Object { $_ -match '(^/|^[A-Za-z]:|(^|/)\.\.(/|$))' }).Count -gt 0) { throw 'Unsafe archive path.' }
    tar -xf $archivePath -C $cacheRoot
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL binary extraction failed.' }
}

$runtimeRoot = Join-Path $projectRoot '.local'
$dataDir = Join-Path $runtimeRoot 'postgres-data-17'
$serverLog = Join-Path $runtimeRoot 'postgres-17.log'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$versionFile = Join-Path $dataDir 'PG_VERSION'
if (Test-Path -LiteralPath $versionFile) {
    if ((Get-Content -LiteralPath $versionFile -Raw).Trim() -ne '17') { throw 'Existing native data belongs to a different PostgreSQL major version.' }
} else {
    if ((Test-Path -LiteralPath $dataDir) -and @(Get-ChildItem -LiteralPath $dataDir -Force).Count -gt 0) { throw 'Native data directory is non-empty but is not a valid PostgreSQL 17 cluster. Review it manually.' }
    $passwordPath = Join-Path $runtimeRoot ('pg-init-' + [System.Guid]::NewGuid().ToString('N') + '.secret')
    try {
        [System.IO.File]::WriteAllText($passwordPath, $localConfig.POSTGRES_PASSWORD + [System.Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
        & $initDb -D $dataDir -U $localConfig.POSTGRES_USER --auth=scram-sha-256 --encoding=UTF8 --locale=C --pwfile=$passwordPath
        if ($LASTEXITCODE -ne 0) { throw 'Native PostgreSQL cluster initialization failed; review its output.' }
    } finally {
        if (Test-Path -LiteralPath $passwordPath) { Remove-Item -LiteralPath $passwordPath -Force }
    }
}

& $pgCtl -D $dataDir status *> $null
if ($LASTEXITCODE -ne 0) {
    & $pgCtl -D $dataDir -l $serverLog -o "-h 127.0.0.1 -p $port" -w -t 45 start
    if ($LASTEXITCODE -ne 0) { throw 'Native PostgreSQL did not become ready; inspect the local server log. Existing data was retained.' }
}
& $postgres --version
& node (Join-Path $PSScriptRoot 'ensure-database.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Native PostgreSQL authentication or database bootstrap failed.' }
