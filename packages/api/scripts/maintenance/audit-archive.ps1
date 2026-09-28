<#
.SYNOPSIS
  Archives audit trail entries older than a cutoff, then removes them.

.DESCRIPTION
  The audit trail is append-only at the database level: rules make UPDATE and
  DELETE no-ops for every role, including the one the API connects with. That is
  deliberate — a trail the application can rewrite is not a trail — and it means
  pruning it cannot be done by the application at all. A DELETE from the API
  would not fail; it would silently remove nothing and report success.

  So this exists, and it is not something to run casually:

    1. Exports the rows to a newline-delimited JSON file.
    2. Verifies the export line count matches what is in the table.
    3. Disables the delete rule, removes the rows, re-enables the rule —
       all in one transaction, so an interruption cannot leave the trail
       writable.
    4. Records what it did, in the trail itself.

  Requires a role that owns the table (ALTER TABLE). The application's own
  database user is not expected to have it, and should not.

  Archives are evidence. Store them where the dumps go, with the same retention
  and the same access control.

.PARAMETER OlderThanDays
  Rows created before this many days ago are archived and removed.
  There is no default: deciding it is the point of running this.

.PARAMETER ArchiveDir
  Where the .jsonl archive is written.

.PARAMETER Database
  Target database. Defaults to the one in DATABASE_URL. Point it at a restored
  copy to rehearse the whole thing without touching the live trail.

.PARAMETER Confirm
  Without it the script exports and reports, but removes nothing.

.EXAMPLE
  # See what two years' retention would remove, and archive it, without deleting
  .\audit-archive.ps1 -OlderThanDays 730 -ArchiveDir D:\archives

.EXAMPLE
  .\audit-archive.ps1 -OlderThanDays 730 -ArchiveDir D:\archives -Confirm
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][int]$OlderThanDays,
  [Parameter(Mandatory = $true)][string]$ArchiveDir,
  [string]$EnvFile = "$PSScriptRoot\..\..\..\..\.env",
  [string]$PgBin = "C:\Program Files\PostgreSQL\16\bin",
  [string]$Database,
  [switch]$Confirm
)

$ErrorActionPreference = 'Stop'

if ($OlderThanDays -lt 1) { throw 'OlderThanDays must be at least 1' }

$line = Select-String -Path $EnvFile -Pattern '^DATABASE_URL=' | Select-Object -First 1
$url = $line.Line -replace '^DATABASE_URL=', '' -replace '^"', '' -replace '"$', ''
if ($url -notmatch '^postgresql://([^:]+):([^@]+)@([^:]+):(\d+)/([^?]+)') {
  throw 'DATABASE_URL is not in the expected form'
}
$user = $Matches[1]; $pass = $Matches[2]; $pgHost = $Matches[3]; $port = $Matches[4]
# Targeting a restored copy is how this gets rehearsed without touching the
# trail it is meant to protect.
$db = if ($Database) { $Database } else { $Matches[5] }
if ($Database -and $Database -ne $Matches[5]) { Write-Output "Targeting $Database (not the live database)" }

New-Item -ItemType Directory -Force -Path $ArchiveDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$archive = Join-Path $ArchiveDir "audit-before-${OlderThanDays}d-$stamp.jsonl"
$psql = "$PgBin\psql.exe"
$env:PGPASSWORD = $pass

try {
  $countSql = Join-Path $env:TEMP "bt-audit-count-$PID.sql"
  "SELECT count(*) FROM audit_log WHERE ""createdAt"" < now() - interval '$OlderThanDays days';" |
    Set-Content -Path $countSql -Encoding utf8
  $expected = [int](& $psql -h $pgHost -p $port -U $user -d $db -t -A -f $countSql)
  Remove-Item $countSql -ErrorAction SilentlyContinue

  Write-Output "$expected entr(ies) older than $OlderThanDays days"
  if ($expected -eq 0) { Write-Output 'Nothing to archive.'; return }

  # One JSON object per line: streamable, appendable, and readable by anything
  # without first loading the whole file.
  $exportSql = Join-Path $env:TEMP "bt-audit-export-$PID.sql"
  @(
    "\copy (SELECT row_to_json(a) FROM (SELECT * FROM audit_log"
    "  WHERE ""createdAt"" < now() - interval '$OlderThanDays days'"
    "  ORDER BY ""createdAt"") a) TO '$($archive -replace '\\', '/')'"
  ) -join ' ' | Set-Content -Path $exportSql -Encoding utf8

  & $psql -h $pgHost -p $port -U $user -d $db -f $exportSql
  if ($LASTEXITCODE -ne 0) { throw 'Export failed; nothing was removed.' }
  Remove-Item $exportSql -ErrorAction SilentlyContinue

  $written = (Get-Content $archive | Measure-Object -Line).Lines
  if ($written -ne $expected) {
    throw "Archive holds $written line(s) but $expected were expected. Nothing removed."
  }
  Write-Output "Archived $written entr(ies) to $(Split-Path $archive -Leaf)"

  if (-not $Confirm) {
    Write-Output ''
    Write-Output 'Dry run: the archive is written, the trail is untouched.'
    Write-Output 'Re-run with -Confirm to remove the archived entries.'
    return
  }

  # The rule comes off and goes back on inside one transaction. If anything
  # fails in between, the rollback restores it — the trail is never left
  # writable because a maintenance script died halfway.
  $pruneSql = Join-Path $env:TEMP "bt-audit-prune-$PID.sql"
  @(
    '\set ON_ERROR_STOP on'
    'BEGIN;'
    'ALTER TABLE audit_log DISABLE RULE audit_log_no_delete;'
    "DELETE FROM audit_log WHERE ""createdAt"" < now() - interval '$OlderThanDays days';"
    'ALTER TABLE audit_log ENABLE RULE audit_log_no_delete;'
    'COMMIT;'
  ) | Set-Content -Path $pruneSql -Encoding utf8

  & $psql -h $pgHost -p $port -U $user -d $db -f $pruneSql
  $pruneExit = $LASTEXITCODE
  Remove-Item $pruneSql -ErrorAction SilentlyContinue
  if ($pruneExit -ne 0) { throw 'Prune failed and was rolled back; the archive is still valid.' }

  # Written after the prune so it survives it, and through the normal INSERT
  # path so the trail records its own maintenance.
  $noteSql = Join-Path $env:TEMP "bt-audit-note-$PID.sql"
  $note = @{
    archivedTo = (Split-Path $archive -Leaf)
    entries    = $written
    olderThanDays = $OlderThanDays
  } | ConvertTo-Json -Compress
  @(
    "INSERT INTO audit_log (id, action, ""entityType"", ""entityId"", metadata, ""createdAt"")"
    "VALUES (gen_random_uuid(), 'DELETE', 'Maintenance', 'audit.archive', '$($note -replace "'", "''")'::jsonb, now());"
  ) -join ' ' | Set-Content -Path $noteSql -Encoding utf8
  & $psql -h $pgHost -p $port -U $user -d $db -f $noteSql | Out-Null
  Remove-Item $noteSql -ErrorAction SilentlyContinue

  Write-Output "Removed $written entr(ies) from the trail."

  $remaining = & $psql -h $pgHost -p $port -U $user -d $db -t -A -c 'SELECT count(*) FROM audit_log;'
  Write-Output "Entries remaining: $remaining"
}
finally { $env:PGPASSWORD = '' }

Write-Output ''
Write-Output 'The archive is evidence. Store it where the database dumps go, under the same access control.'
