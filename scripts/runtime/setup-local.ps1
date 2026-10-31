[CmdletBinding()]
param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 55432
)

$ErrorActionPreference = 'Stop'
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$envPath = Join-Path $projectRoot '.env.local'

if (Test-Path -LiteralPath $envPath) {
    Write-Output '.env.local already exists; credentials were preserved.'
    exit 0
}

$passwordBytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Fill($passwordBytes)
$localPassword = [System.Convert]::ToHexString($passwordBytes).ToLowerInvariant()
$content = @(
    '# Local development only. Generated secrets; do not commit or copy into logs.'
    'POSTGRES_HOST=127.0.0.1'
    ('POSTGRES_PORT=' + $Port)
    'POSTGRES_USER=geo'
    'POSTGRES_DB=geo'
    ('POSTGRES_PASSWORD=' + $localPassword)
    ('DATABASE_URL=postgresql://geo:' + $localPassword + '@127.0.0.1:' + $Port + '/geo')
) -join [System.Environment]::NewLine

$stream = [System.IO.File]::Open($envPath, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
try {
    $writer = [System.IO.StreamWriter]::new($stream, [System.Text.UTF8Encoding]::new($false))
    try { $writer.WriteLine($content) } finally { $writer.Dispose() }
} finally { $stream.Dispose() }

Write-Output ('Created ignored .env.local for PostgreSQL on 127.0.0.1:' + $Port + '. No credentials were printed.')
