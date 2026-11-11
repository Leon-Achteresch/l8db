$ErrorActionPreference = 'Stop'
$p = Join-Path ([IO.Path]::GetTempPath()) "probe-$PID"
New-Item -ItemType Directory -Force (Join-Path $p 'bin') | Out-Null
$exe = Join-Path $p 'probe.exe'
rustc --edition 2021 -o $exe (Join-Path $PSScriptRoot 'probe.rs')
$env:PROBE_LOG = Join-Path $p 'log.txt'
$shim = Join-Path $p 'bin\probe.cmd'
Set-Content -Encoding ascii $shim "@echo off`r`n`"%~dp0..\probe.exe`" %*`r`n"
$dump = Join-Path $p 'dump.ps1'
@'
$raw = $Host.UI.RawUI
$last = $raw.CursorPosition.Y
$width = $raw.BufferSize.Width
$cells = $raw.GetBufferContents([Management.Automation.Host.Rectangle]::new(0, 0, $width - 1, $last))
$lines = for ($y = 0; $y -le $last; $y++) { (-join (0..($width - 1) | ForEach-Object { $cells[$y, $_].Character })).TrimEnd() }
$lines | Where-Object { $_ } | Set-Content -Encoding utf8 $args[0]
'@ | Set-Content -Encoding utf8 $dump

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
  $flat = { param($text) ($text.Trim() -replace "`r?`n", ' | ') }
  'code={0} out=[{1}] err=[{2}]' -f $process.ExitCode, (& $flat $out.Result), (& $flat $err.Result)
}

function Batch([string]$tail, $stdin = $null) {
  $line = '/d /s /c ""' + $shim + '" ' + $tail + '"'
  Run 'cmd.exe' $line $stdin
}

function Screen([string]$tail) {
  $screen = Join-Path $p 'screen.txt'
  Remove-Item $screen -ErrorAction SilentlyContinue
  $line = '/d /s /c ""' + $shim + '" ' + $tail + ' & echo DONE & powershell -NoProfile -ExecutionPolicy Bypass -File "' + $dump + '" "' + $screen + '""'
  Start-Process cmd.exe -Wait -ArgumentList $line
  if (Test-Path $screen) { (Get-Content $screen) -join ' | ' } else { 'no screen' }
}

foreach ($strategy in 'attach', 'pipefile', 'smart', 'all', 'none') {
  Write-Host "=== $strategy"
  $result = Batch "$strategy-pipes"
  Write-Host "pipes:        $result"
  $file = Join-Path $p "$strategy.txt"
  $result = Batch ($strategy + '-file > "' + $file + '"')
  $content = if (Test-Path $file) { (Get-Content $file) -join ' | ' } else { 'missing' }
  Write-Host "file:         $result file=[$content]"
  $result = Batch "$strategy-nul > NUL"
  Write-Host "nul:          $result"
  $result = Batch "$strategy-stdin" 'hello'
  Write-Host "stdin:        $result"
  $result = Screen "$strategy-console"
  Write-Host "console:      [$result]"
  $file = Join-Path $p "$strategy-console.txt"
  $result = Screen ($strategy + '-consolefile > "' + $file + '"')
  $content = if (Test-Path $file) { (Get-Content $file) -join ' | ' } else { 'missing' }
  Write-Host "console+file: [$result] file=[$content]"
  $result = Screen "$strategy-consolenul > NUL"
  Write-Host "console+nul:  [$result]"
}
Write-Host '--- log'
Get-Content $env:PROBE_LOG | Write-Host
