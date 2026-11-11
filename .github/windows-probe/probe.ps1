$ErrorActionPreference = 'Stop'
$p = Join-Path ([IO.Path]::GetTempPath()) "probe-$PID"
New-Item -ItemType Directory -Force (Join-Path $p 'bin') | Out-Null
rustc --edition 2021 -o (Join-Path $p 'probe.exe') (Join-Path $PSScriptRoot 'probe.rs')
$exe = Join-Path $p 'probe.exe'
$env:PROBE_LOG = Join-Path $p 'log.txt'
$shims = [ordered]@{
  plain    = '"%~dp0..\probe.exe" %*'
  call     = 'call "%~dp0..\probe.exe" %*'
  startbw  = 'start "" /b /wait "%~dp0..\probe.exe" %*'
  redirect = '"%~dp0..\probe.exe" %* 1>&1 2>&2'
  nested   = 'cmd /d /s /c ""%~dp0..\probe.exe" %*"'
  piped    = '"%~dp0..\probe.exe" %* | findstr /r "^"'
}
foreach ($name in $shims.Keys) {
  Set-Content -Encoding ascii (Join-Path $p "bin\$name.cmd") "@echo off`r`n$($shims[$name])`r`n"
}

function Run([string]$file, [string]$arguments, $stdin = $null) {
  $info = [Diagnostics.ProcessStartInfo]::new($file, $arguments)
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.RedirectStandardInput = $true
  $process = [Diagnostics.Process]::Start($info)
  $out = $process.StandardOutput.ReadToEndAsync()
  $err = $process.StandardError.ReadToEndAsync()
  if ($null -ne $stdin) { $process.StandardInput.Write($stdin) }
  $process.StandardInput.Close()
  if (-not $process.WaitForExit(60000)) { $process.Kill(); return 'TIMEOUT' }
  "code=$($process.ExitCode) out=[$($out.Result.Trim() -replace "`r?`n", ' | ')] err=[$($err.Result.Trim())]"
}

Write-Host "direct:        $(Run $exe 'direct')"
Write-Host "direct-noatt:  $(Run $exe 'direct-noattach')"
Write-Host "cmdc:          $(Run 'cmd.exe' "/d /s /c `"`"$exe`" cmdc`"")"
Write-Host "cmdc-noatt:    $(Run 'cmd.exe' "/d /s /c `"`"$exe`" cmdc-noattach`"")"
foreach ($name in $shims.Keys) {
  $shim = Join-Path $p "bin\$name.cmd"
  Write-Host "batch-${name}:        $(Run 'cmd.exe' "/d /s /c `"`"$shim`" batch-$name`"")"
  Write-Host "batch-${name}-noatt:  $(Run 'cmd.exe' "/d /s /c `"`"$shim`" batch-$name-noattach`"")"
}
$plain = Join-Path $p 'bin\plain.cmd'
Write-Host "typed-direct:  $(Run 'cmd.exe' '/d /q' "`"$exe`" typed-direct`r`nexit`r`n")"
Write-Host "typed-batch:   $(Run 'cmd.exe' '/d /q' "`"$plain`" typed-batch`r`necho AFTER`r`nexit`r`n")"
$ps = & $plain ps-batch
Write-Host "ps-batch:      out=[$ps] code=$LASTEXITCODE"
$ps = & $plain ps-batch-noattach
Write-Host "ps-batch-noatt: out=[$ps] code=$LASTEXITCODE"
Write-Host '--- log'
Get-Content $env:PROBE_LOG | Write-Host
