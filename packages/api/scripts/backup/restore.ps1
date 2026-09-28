<#
.SYNOPSIS
  Restores a Black Ticket dump into a database.

.DESCRIPTION
  Defaults to restoring into a NEW database rather than over the live one,
  because the common reason to run a restore is to check that the backups are
  good — and a rehearsal that overwrites production is not a rehearsal.

  Overwriting the live database is possible but has to be asked for explicitly
  with -Force, and the script will still refuse if anything is connected to it.

  After restoring, if the application code is newer than the dump, run
  `npx prisma migrate deploy` against the restored database before pointing the
  API at it. The manifest beside each dump lists the migrations it contains.

.PARAMETER Dump
  Path to a .dump file produced by backup.ps1.

.PARAMETER Target
  Database to restore into. Must not exist unless -Force is given.

.EXAMPLE
  .\restore.ps1 -Dump D:\backups\blackticket-20260827-120000.dump -Target blackticket_restore_test
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Dump,
  [Parameter(Mandatory = $true)][string]$Target,
  [string]$EnvFile = "$PSScriptRoot\..\..\..\..\.env",
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Dump)) { throw "No dump at $Dump" }

$line = Select-String -Path $EnvFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
$url = $line.Line -replace '^DATABASE_URL=', '' -replace '^"', '' -replace '"$', ''
if ($url -notmatch '^postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)') {
  throw 'DATABASE_URL is not in the expected form'
}
$user = $Matches[1]; $pass = $Matches[2]; $pgHost = $Matches[3]; $port = $Matches[4]; $live = $Matches[5]

if ($Target -eq $live -and -not $Force) {
  throw "$Target is the live database. Re-run with -Force if you really mean to overwrite it."
}

$env:PGPASSWORD = $pass
try {
  $psql = "$PgBin\psql.exe"

  $exists = & $psql -h $pgHost -p $port -U $user -d postgres -t -A `
    -c "SELECT 1 FROM pg_database WHERE datname = '$Target';"

  if ($exists -and -not $Force) {
    throw "$Target already exists. Choose another name, or pass -Force to replace it."
  }

  if ($exists) {
    # Anything still connected would make the drop fail halfway and leave the
    # target in a state that is neither the old database nor the new one.
    $busy = & $psql -h $pgHost -p $port -U $user -d postgres -t -A `
      -c "SELECT count(*) FROM pg_stat_activity WHERE datname = '$Target' AND pid <> pg_backend_pid();"
    if ([int]$busy -gt 0) {
      throw "$Target has $busy open connection(s). Stop the API before restoring over it."
    }
    Write-Output "Dropping $Target"
    & $psql -h $pgHost -p $port -U $user -d postgres -c "DROP DATABASE ""$Target"";" | Out-Null
  }

  Write-Output "Creating $Target"
  & $psql -h $pgHost -p $port -U $user -d postgres -c "CREATE DATABASE ""$Target"";" | Out-Null

  Write-Output "Restoring $(Split-Path $Dump -Leaf)"
  # --exit-on-error so a partial restore is a failure rather than a database
  # that looks fine and is missing rows.
  & "$PgBin\pg_restore.exe" -h $pgHost -p $port -U $user -d $Target --no-owner --exit-on-error $Dump
  if ($LASTEXITCODE -ne 0) { throw "pg_restore failed with exit code $LASTEXITCODE" }

  Write-Output ''
  Write-Output 'Restored. Row counts:'
  # Written to a file rather than passed with -c: `case` and `user` are reserved
  # words needing double quotes, and PowerShell strips those on the way to the
  # executable, leaving psql with a syntax error.
  $countsSql = Join-Path $env:TEMP "bt-restore-counts-$PID.sql"
  @(
    'SELECT ''user'' AS tablo, count(*) FROM "user"'
    'UNION ALL SELECT ''case'', count(*) FROM "case"'
    'UNION ALL SELECT ''observable'', count(*) FROM observable'
    'UNION ALL SELECT ''case_observable'', count(*) FROM case_observable'
    'UNION ALL SELECT ''audit_log'', count(*) FROM audit_log'
    'UNION ALL SELECT ''api_key'', count(*) FROM api_key'
    'ORDER BY 1;'
  ) | Set-Content -Path $countsSql -Encoding utf8
  try { & $psql -h $pgHost -p $port -U $user -d $Target -f $countsSql }
  finally { Remove-Item $countsSql -ErrorAction SilentlyContinue }

  $applied = & $psql -h $pgHost -p $port -U $user -d $Target -t -A `
    -c 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;'
  Write-Output "Migrations in the restored database: $applied"
}
finally { $env:PGPASSWORD = '' }

Write-Output ''
Write-Output 'Next:'
Write-Output '  1. If the code is newer than the dump, run prisma migrate deploy against this database.'
Write-Output '  2. Point the API at it with the SAME TOTP_ENCRYPTION_KEY the dump was taken under,'
Write-Output '     or two-factor, single sign-on and outbound mail will all fail to decrypt.'
