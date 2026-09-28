<#
.SYNOPSIS
  Takes a restorable backup of Black Ticket.

.DESCRIPTION
  A database dump on its own is NOT a restorable backup of this system.

  Three kinds of secret live in the database encrypted, with the key held in the
  environment and never in PostgreSQL: every user's TOTP seed, the OIDC client
  secret, and the outbound mail password. Restore the database without that key
  and you get a system where two-factor is broken for everyone, single sign-on
  cannot authenticate, and mail cannot send — with no way to recover any of it.

  So this script does two things: it dumps the database, and it refuses to call
  the result a backup unless the key material has been dealt with too.

.PARAMETER OutDir
  Where backups are written. Created if missing.

.PARAMETER EnvFile
  The .env holding DATABASE_URL and the encryption keys.

.PARAMETER KeepDays
  Delete dumps older than this. 0 keeps everything.

.EXAMPLE
  .\backup.ps1 -OutDir D:\backups\blackticket -KeepDays 30
#>
[CmdletBinding()]
param(
  [string]$OutDir = "$PSScriptRoot\..\..\..\..\backups",
  [string]$EnvFile = "$PSScriptRoot\..\..\..\..\.env",
  [int]$KeepDays = 30,
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin"
)

$ErrorActionPreference = 'Stop'

function Read-DatabaseUrl {
  param([string]$Path)
  if (-not (Test-Path $Path)) { throw "No .env at $Path" }
  $line = Select-String -Path $Path -Pattern '^DATABASE_URL=' | Select-Object -First 1
  if (-not $line) { throw "DATABASE_URL not found in $Path" }
  $url = $line.Line -replace '^DATABASE_URL=', '' -replace '^"', '' -replace '"$', ''
  if ($url -notmatch '^postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)') {
    throw 'DATABASE_URL is not in the expected postgresql://user:pass@host:port/db form'
  }
  [pscustomobject]@{
    User = $Matches[1]; Password = $Matches[2]; Host = $Matches[3]
    Port = $Matches[4]; Database = $Matches[5]
  }
}

$db = Read-DatabaseUrl -Path $EnvFile
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$dump = Join-Path $OutDir "blackticket-$stamp.dump"

Write-Output "Dumping $($db.Database) from $($db.Host):$($db.Port)"
$env:PGPASSWORD = $db.Password
try {
  # Custom format: compressed, and pg_restore can read a single table out of it
  # without replaying the whole thing.
  & "$PgBin\pg_dump.exe" -h $db.Host -p $db.Port -U $db.User -d $db.Database `
    --format=custom --compress=6 --file=$dump
  if ($LASTEXITCODE -ne 0) { throw "pg_dump failed with exit code $LASTEXITCODE" }

  # A dump that cannot be listed cannot be restored. Checking now beats finding
  # out during an incident.
  $toc = & "$PgBin\pg_restore.exe" --list $dump 2>&1
  if ($LASTEXITCODE -ne 0) { throw 'pg_dump produced a file pg_restore cannot read' }
  $tables = ($toc | Select-String -Pattern 'TABLE DATA' | Measure-Object).Count

  # Which migrations the dump contains, so whoever restores it knows whether the
  # code they are restoring alongside is ahead of it.
  $migrations = & "$PgBin\psql.exe" -h $db.Host -p $db.Port -U $db.User -d $db.Database `
    -t -A -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY finished_at;'
}
finally { $env:PGPASSWORD = '' }

$size = (Get-Item $dump).Length / 1MB
Write-Output ("Wrote {0} ({1:N1} MB, {2} tables with data)" -f (Split-Path $dump -Leaf), $size, $tables)

# Recorded beside the dump rather than inside it: this is what tells a future
# restorer what else they need.
$manifest = Join-Path $OutDir "blackticket-$stamp.manifest.txt"
@(
  "Black Ticket backup"
  "taken:      $(Get-Date -Format 'u')"
  "database:   $($db.Database) @ $($db.Host):$($db.Port)"
  "dump:       $(Split-Path $dump -Leaf)"
  "size:       $([math]::Round($size,1)) MB"
  ""
  "migrations applied at the time of this dump:"
  ($migrations | ForEach-Object { "  $_" })
  ""
  "REQUIRED TO RESTORE, and NOT contained in the dump:"
  "  TOTP_ENCRYPTION_KEY  - decrypts every TOTP seed, the OIDC client secret"
  "                         and the outbound mail password. Lose it and those"
  "                         are unrecoverable; the accounts and settings survive"
  "                         but two-factor, SSO and mail all have to be set up"
  "                         again from scratch."
  "  JWT_ACCESS_SECRET    - losing these only signs everyone out."
  "  JWT_REFRESH_SECRET"
  ""
  "Store the key material separately from these dumps, in whatever your"
  "organisation uses for secrets. A dump and its key in the same folder is one"
  "stolen folder away from being no protection at all."
) | Set-Content -Path $manifest -Encoding utf8

Write-Output "Wrote $(Split-Path $manifest -Leaf)"

if ($KeepDays -gt 0) {
  $cutoff = (Get-Date).AddDays(-$KeepDays)
  $old = Get-ChildItem $OutDir -Filter 'blackticket-*' | Where-Object { $_.LastWriteTime -lt $cutoff }
  if ($old) {
    $old | Remove-Item -Force
    Write-Output "Pruned $($old.Count) file(s) older than $KeepDays days"
  }
}

Write-Warning 'The database is backed up. The encryption key is NOT. Confirm it is stored somewhere you can reach without this server.'
