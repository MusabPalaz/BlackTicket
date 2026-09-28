<#
.SYNOPSIS
  Builds the zip that goes to a customer.

.DESCRIPTION
  A release bundle is assembled, not hand-picked. Zipping docker/ as it stands
  would hand over two Dockerfiles and an nginx config that are build-time files:
  the Dockerfiles need the whole repository as build context, so a customer who
  tried `docker compose build` would get a confusing failure, and the nginx
  config is already baked into the web image and never read at runtime.

  What goes in is what a customer actually runs:

    compose.yml   .env.example   Caddyfile   update.sh   README.md   certs/

  Two distribution modes, and the bundle is honest about which one it is:

    -Registry <path>   the customer pulls from that registry
    -Offline           the images ride along in images/ as tar files

  The README ships only the section that applies, because a customer told to
  look in images/ when there is no images/ has been handed a broken instruction.

.PARAMETER Version
  Release tag. Goes into the zip name and is written into .env.example as TAG,
  so the customer's first install pins a version rather than tracking `latest`.

.PARAMETER Registry
  Where the images are published, e.g. ghcr.io/acme or registry.firma.local/soc.
  The api and web images are expected at <Registry>/api and <Registry>/web.
  Required unless -Offline: an online bundle pointing at a registry nobody has
  published to fails on the customer's server with a bare "denied", which looks
  like a credentials problem and is not one.

.PARAMETER Offline
  Export the images into the bundle. Requires them to be built locally, and
  makes the zip large (hundreds of megabytes).

.PARAMETER Readme
  The installation guide that ships as README.md. Defaults to
  customer-README.md; pass a translated copy to give a customer the guide in
  their own language. It must carry the same ONLINE/OFFLINE START/END markers.

.EXAMPLE
  .\package.ps1 -Version v1.0.0 -Registry ghcr.io/acme
  .\package.ps1 -Version v1.0.0 -Offline
  .\package.ps1 -Version v1.0.0 -Offline -Readme ..\_tr\docker\customer-README.md
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [string]$OutDir = "$PSScriptRoot\..\dist",
  [string]$Registry,
  [switch]$Offline,
  [string]$Readme = (Join-Path $PSScriptRoot 'customer-README.md')
)

$ErrorActionPreference = 'Stop'

if ($Version -notmatch '^v?\d+\.\d+\.\d+') {
  throw "Version should look like v1.0.0, got '$Version'"
}

# --- where the images come from ------------------------------------------
# Resolved once, here, and written into .env.example. Nothing downstream gets
# to fall back to a guess.
if ($Registry) {
  $base = $Registry.TrimEnd('/')
  $imageApi = "$base/api"
  $imageWeb = "$base/web"
}
elseif ($Offline) {
  # docker save preserves the name it was tagged with, and docker load restores
  # exactly that, so .env has to name the same thing or compose goes looking in
  # a registry for an image that is already on disk.
  $imageApi = 'blackticket/api'
  $imageWeb = 'blackticket/web'
}
else {
  throw @'
No -Registry and no -Offline, so there is nowhere for the customer to get the
images from. Pick one:

  -Registry ghcr.io/acme    they pull from there (it must really be published,
                            and they must be able to reach and read it)
  -Offline                  the images travel inside the zip

Shipping a bundle that names a registry nobody published to is how a customer
ends up staring at "denied" for an image that never existed.
'@
}

$staging = Join-Path ([System.IO.Path]::GetTempPath()) "blackticket-pkg-$PID"
$bundle = Join-Path $staging 'blackticket'
New-Item -ItemType Directory -Force -Path $bundle | Out-Null

try {
  # Fail before assembling anything, not halfway through a 600 MB export.
  if ($Offline) {
    foreach ($ref in "${imageApi}:$Version", "${imageWeb}:$Version", 'postgres:16-alpine', 'caddy:2-alpine') {
      docker image inspect $ref 2>&1 | Out-Null
      if ($LASTEXITCODE -ne 0) {
        throw "Image '$ref' is not on this machine. Build or pull it before packaging."
      }
    }
  }

  # --- what the customer runs -------------------------------------------
  foreach ($file in 'compose.yml', 'Caddyfile') {
    Copy-Item (Join-Path $PSScriptRoot $file) -Destination $bundle
  }

  # The README ships one start procedure: the one that works here.
  $readmePath = (Resolve-Path $Readme).Path
  $readme = [System.IO.File]::ReadAllText($readmePath)
  foreach ($marker in 'ONLINE', 'OFFLINE') {
    if ($readme -notmatch "<!-- ${marker}:START -->") {
      throw "$(Split-Path $readmePath -Leaf) is missing the <!-- ${marker}:START --> marker."
    }
  }
  $drop = if ($Offline) { 'ONLINE' } else { 'OFFLINE' }
  $keep = if ($Offline) { 'OFFLINE' } else { 'ONLINE' }
  $readme = [regex]::Replace($readme, "(?s)<!-- ${drop}:START -->.*?<!-- ${drop}:END -->\r?\n", '')
  $readme = [regex]::Replace($readme, "<!-- ${keep}:(START|END) -->\r?\n", '')
  if ($readme -match '<!-- (ONLINE|OFFLINE):(START|END) -->') {
    throw 'A start-section marker survived into the customer README.'
  }
  [System.IO.File]::WriteAllText((Join-Path $bundle 'README.md'), $readme)

  # The version and the image locations are pinned in the file the customer
  # copies, so their first install is on a known release from a known place
  # instead of whatever `latest` points at in a registry we guessed.
  $envExample = Get-Content (Join-Path $PSScriptRoot '.env.example') -Raw
  $envExample = $envExample -replace '(?m)^TAG=.*$', "TAG=$Version"
  $envExample = $envExample -replace '(?m)^IMAGE_API=.*$', "IMAGE_API=$imageApi"
  $envExample = $envExample -replace '(?m)^IMAGE_WEB=.*$', "IMAGE_WEB=$imageWeb"
  foreach ($key in 'TAG', 'IMAGE_API', 'IMAGE_WEB') {
    if ($envExample -notmatch "(?m)^${key}=\S") {
      throw "$key was not filled in .env.example. Does the key still exist there?"
    }
  }
  Set-Content -Path (Join-Path $bundle '.env.example') -Value $envExample -Encoding utf8 -NoNewline

  # update.sh has to stay runnable after a round trip through Windows.
  # Set-Content would rewrite the line endings; a shell script with CRLF fails
  # on Linux with a confusing "bad interpreter" error.
  $script = [System.IO.File]::ReadAllText((Join-Path $PSScriptRoot 'update.sh')) -replace "`r`n", "`n"
  [System.IO.File]::WriteAllText((Join-Path $bundle 'update.sh'), $script)

  New-Item -ItemType Directory -Force -Path (Join-Path $bundle 'certs') | Out-Null
  @(
    'Put your certificate here:'
    ''
    '  server.crt   the certificate (with any intermediates appended)'
    '  server.key   its private key'
    ''
    'No public CA can issue a certificate for an internal DNS name; get one from'
    'your own CA. PUBLIC_HOST in .env must match the certificate''s CN/SAN.'
  ) -join "`n" | Set-Content -Path (Join-Path $bundle 'certs\README.txt') -Encoding utf8

  # --- optional offline images ------------------------------------------
  if ($Offline) {
    $images = Join-Path $bundle 'images'
    New-Item -ItemType Directory -Force -Path $images | Out-Null

    foreach ($pair in @(
        @{ Ref = "${imageApi}:$Version"; File = 'api.tar' },
        @{ Ref = "${imageWeb}:$Version"; File = 'web.tar' },
        @{ Ref = 'postgres:16-alpine'; File = 'postgres.tar' },
        @{ Ref = 'caddy:2-alpine'; File = 'caddy.tar' }
      )) {
      Write-Output "  exporting $($pair.Ref)"
      docker save -o (Join-Path $images $pair.File) $pair.Ref
      if ($LASTEXITCODE -ne 0) {
        throw "docker save failed for $($pair.Ref)."
      }
    }
  }

  # --- zip ---------------------------------------------------------------
  # Not Compress-Archive: on Windows PowerShell it writes entry names with
  # backslashes, which the zip format does not allow. Info-ZIP repairs them
  # with a warning, but other extractors create a file literally called
  # "certs\README.txt" and the customer never gets a certs directory.
  Add-Type -AssemblyName System.IO.Compression | Out-Null
  Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null

  New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
  $OutDir = (Resolve-Path $OutDir).Path
  $zip = Join-Path $OutDir "blackticket-install-$Version.zip"
  if (Test-Path $zip) { Remove-Item $zip -Force }

  $stream = [System.IO.File]::Open($zip, [System.IO.FileMode]::CreateNew)
  try {
    $archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
      foreach ($f in Get-ChildItem $bundle -Recurse -File) {
        $entry = $f.FullName.Substring($bundle.Length + 1).Replace('\', '/')
        # Image layers are already compressed; deflating them again buys
        # nothing and costs minutes.
        $level = if ($f.Extension -eq '.tar') {
          [System.IO.Compression.CompressionLevel]::NoCompression
        } else {
          [System.IO.Compression.CompressionLevel]::Optimal
        }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $f.FullName, $entry, $level) | Out-Null
      }
    }
    finally { $archive.Dispose() }
  }
  finally { $stream.Dispose() }

  $size = (Get-Item $zip).Length / 1MB
  Write-Output ''
  Write-Output ("Wrote {0} ({1:N1} MB)" -f (Split-Path $zip -Leaf), $size)
  Write-Output ("  images: {0}:{1} and {2}:{1}" -f $imageApi, $Version, $imageWeb)
  Write-Output ("  mode:   {0}" -f $(if ($Offline) { 'offline (images inside)' } else { 'registry pull' }))
  Write-Output 'Contents:'
  Get-ChildItem $bundle -Recurse -File |
    ForEach-Object { Write-Output ("  " + $_.FullName.Substring($bundle.Length + 1).Replace('\', '/')) }

  if (-not $Offline) {
    Write-Output ''
    Write-Output "Before sending this: push ${imageApi}:$Version and ${imageWeb}:$Version,"
    Write-Output 'and confirm the customer can reach and read that registry. If either is'
    Write-Output 'in doubt, re-run with -Offline instead.'
  }
}
finally {
  Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}
