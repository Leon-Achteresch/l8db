param([string]$Root, [string]$Current, [string]$Version, [string]$Previous, [string]$PreviousVersion)
$ErrorActionPreference = 'Stop'
$install = Join-Path $Root 'installed'
$binary = Join-Path $install 'l8db.exe'
function Stop-TestApp {
  Get-Process l8db -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $binary } | Stop-Process -Force
}
function Start-TestApp([string]$ExpectedVersion) {
  Stop-TestApp
  $actual = (Get-Item $binary).VersionInfo.ProductVersion
  if ($actual -match '^\d+\.\d+\.\d+\.0$') { $actual = $actual.Substring(0, $actual.Length - 2) }
  if ($actual -ne $ExpectedVersion) { throw "Installed Windows version mismatch: $actual" }
  $probe = Start-Process $binary -ArgumentList '--check' -PassThru -Wait -NoNewWindow
  if ($probe.ExitCode -ne 2) { throw "Installed CLI failed: $($probe.ExitCode)" }
  $app = Start-Process $binary -PassThru
  try {
    if ($app.WaitForExit(10000)) { throw "Installed GUI exited: $($app.ExitCode)" }
    $app.Refresh()
    if ($app.MainWindowHandle -eq 0) { throw 'Installed GUI did not open a window' }
  } finally { Stop-TestApp }
}
function Install-TestApp([string]$Directory, [string]$ExpectedVersion, [bool]$Upgrade) {
  $installer = Join-Path $Directory "l8db_${ExpectedVersion}_x64-setup.exe"
  $arguments = @('/S')
  if ($Upgrade) { $arguments += '/UPDATE' }
  $arguments += "/D=$install"
  $process = Start-Process $installer -ArgumentList $arguments -PassThru -Wait
  if ($process.ExitCode -ne 0) { throw "NSIS installation failed: $($process.ExitCode)" }
  Start-TestApp $ExpectedVersion
}
if ($PreviousVersion) { Install-TestApp $Previous $PreviousVersion $false }
Install-TestApp $Current $Version ([bool]$PreviousVersion)
$metadata = Get-Content 'build-windows.json' -Raw | ConvertFrom-Json
if ((Get-FileHash $binary -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.binarySha256) { throw 'NSIS contains a different application' }
$msi = Join-Path $Current "l8db_${Version}_x64_en-US.msi"
$extract = Join-Path $Root 'msi'
$process = Start-Process msiexec -ArgumentList @('/a', "`"$msi`"", '/qn', "TARGETDIR=`"$extract`"") -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "MSI extraction failed: $($process.ExitCode)" }
$msiBinary = Get-ChildItem $extract -Filter l8db.exe -Recurse | Select-Object -First 1
if (!$msiBinary -or (Get-FileHash $msiBinary.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -ne $metadata.binarySha256) { throw 'MSI contains a different application' }
