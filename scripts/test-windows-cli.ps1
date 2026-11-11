$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\src-tauri\target\debug')).Path
$exe = Join-Path $root 'l8db.exe'
$bin = Join-Path $root 'bin'
$shim = Join-Path $bin 'l8db.cmd'
$work = Join-Path ([IO.Path]::GetTempPath()) "l8db-cli-$PID"
New-Item -ItemType Directory -Force $work | Out-Null
$db = Join-Path $work 'probe.sqlite'
New-Item -ItemType File -Force $db | Out-Null
$env:L8DB_AUTOMATION_DB = Join-Path $work 'automation.db'
$env:L8DB_CLI_CONFIG = Join-Path $work 'cli.json'
$env:L8DB_DEV_SECRETS = Join-Path $work 'secrets.json'
$script:failed = 0

function Check([string]$name, [bool]$ok, $detail = '') {
  if ($ok) {
    Write-Host "ok   $name"
  } else {
    Write-Host "FAIL $name"
    Write-Host ($detail | Format-List | Out-String).Trim()
    $script:failed++
  }
}

function Run([string]$file, [string]$arguments, $stdin = $null) {
  $info = [Diagnostics.ProcessStartInfo]::new($file, $arguments)
  $info.UseShellExecute = $false
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  $info.RedirectStandardInput = $true
  $info.StandardOutputEncoding = [Text.Encoding]::UTF8
  $info.StandardErrorEncoding = [Text.Encoding]::UTF8
  $process = [Diagnostics.Process]::Start($info)
  $out = $process.StandardOutput.ReadToEndAsync()
  $err = $process.StandardError.ReadToEndAsync()
  if ($null -ne $stdin) { $process.StandardInput.Write($stdin) }
  $process.StandardInput.Close()
  if (-not $process.WaitForExit(120000)) {
    $process.Kill()
    return [pscustomobject]@{ code = -1; out = 'TIMEOUT'; err = 'TIMEOUT' }
  }
  [pscustomobject]@{ code = $process.ExitCode; out = $out.Result; err = $err.Result }
}

function Cmd([string]$line, $stdin = $null) {
  Run 'cmd.exe' "/d /s /c `"$line`"" $stdin
}

function Lines([string]$text) {
  @($text -split "`r?`n" | ForEach-Object { $_.TrimEnd() } | Where-Object { $_ -ne '' })
}

Check 'binary exists' (Test-Path $exe) $exe
Check 'bundle resource copies the starter to bin\l8db.cmd' (Test-Path $shim) (Get-ChildItem $root -Name | Select-Object -First 40)
if ($script:failed -gt 0) { exit 1 }

foreach ($spelling in 'version', '-v', '-V', '--version') {
  $result = Cmd "`"$shim`" $spelling"
  Check "cmd: $spelling prints the version and ends with 0" ($result.code -eq 0 -and $result.out -match '^l8db \d+\.\d+\.\d+') $result
}

$unknown = Cmd "`"$shim`" nonsense"
Check 'cmd: unknown command ends with 2 and a German error' ($unknown.code -eq 2 -and $unknown.err -match 'Unbekannter Befehl') $unknown

$help = Cmd "`"$shim`" help"
Check 'cmd: help lists the commands' ($help.code -eq 0 -and $help.out -match 'version' -and $help.out -match 'conn list') $help

$completions = Cmd "`"$shim`" completions powershell"
Check 'cmd: completions end with 0' ($completions.code -eq 0 -and $completions.out.Length -gt 200) $completions.err

$empty = Cmd "`"$shim`" conn list"
Check 'cmd: an empty store lists nothing and ends with 0' ($empty.code -eq 0 -and $empty.out -match 'name') $empty

$doctor = Cmd "`"$shim`" doctor -o json"
$doctorRows = try { @($doctor.out | ConvertFrom-Json | Where-Object { $_.check }).Count } catch { 0 }
Check 'cmd: doctor writes JSON and ends' (($doctor.code -eq 0 -or $doctor.code -eq 1) -and $doctorRows -gt 0) $doctor

$query = Cmd "`"$shim`" --url `"$db`" q `"select 'a b' as x, 2 > 1 as y, 10 % 3 as z`" -o csv"
Check 'cmd: quoted SQL with spaces, > and % reaches SQLite' ($query.code -eq 0 -and (Lines $query.out) -join '|' -eq 'x,y,z|a b,1,1') $query

$piped = Cmd "`"$shim`" --url `"$db`" q -o csv" "select 7 as s"
Check 'cmd: SQL from standard input' ($piped.code -eq 0 -and (Lines $piped.out) -join '|' -eq 's|7') $piped

$target = Join-Path $work 'out.csv'
$redirected = Cmd "`"$shim`" --url `"$db`" q `"select 5 as f`" -o csv > `"$target`""
$written = if (Test-Path $target) { (Lines (Get-Content -Raw $target)) -join '|' } else { 'missing' }
Check 'cmd: output redirects into a file' ($redirected.code -eq 0 -and $written -eq 'f|5') "$($redirected.err) $written"

$broken = Cmd "`"$shim`" --url `"$db`" q `"select * from missing_table`""
Check 'cmd: a failing query ends with 1' ($broken.code -eq 1 -and $broken.err -match 'Fehler') $broken

$wide = Cmd "`"$shim`" --url `"$db`" q `"select 1 as a, 2 as b`" -o table"
Check 'cmd: table output draws the grid' ($wide.code -eq 0 -and $wide.out -match 'a' -and $wide.out -match '2') $wide

$psVersion = & $shim version
Check 'PowerShell: starter prints the version and sets $LASTEXITCODE 0' ($LASTEXITCODE -eq 0 -and "$psVersion" -match '^l8db ') "$psVersion / $LASTEXITCODE"
& $shim nonsense 2>$null | Out-Null
Check 'PowerShell: unknown command sets $LASTEXITCODE 2' ($LASTEXITCODE -eq 2) $LASTEXITCODE
$psQuery = & $shim --url $db q "select 'a b' as x" -o csv
Check 'PowerShell: quoted SQL reaches SQLite' ($LASTEXITCODE -eq 0 -and ($psQuery -join '|') -eq 'x|a b') ($psQuery -join '|')

$session = "`"$shim`" version`r`necho AFTER-%errorlevel%`r`n`"$shim`" nonsense`r`necho CODE-%errorlevel%`r`nexit`r`n"
$typed = Run 'cmd.exe' '/d /q' $session
$typedLines = Lines $typed.out
$versionAt = [array]::FindIndex([string[]]$typedLines, [Predicate[string]] { param($l) $l -match 'l8db \d+\.\d+\.\d+' })
$afterAt = [array]::FindIndex([string[]]$typedLines, [Predicate[string]] { param($l) $l -match 'AFTER-0' })
Check 'typed into cmd: the starter finishes before the next command runs' ($versionAt -ge 0 -and $afterAt -gt $versionAt) $typed
Check 'typed into cmd: the exit code is visible in %errorlevel%' ($typed.out -match 'CODE-2') $typed

$direct = Run 'cmd.exe' '/d /q' "`"$exe`" version`r`necho AFTER`r`nexit`r`n"
$directLines = Lines $direct.out
$directVersion = [array]::FindIndex([string[]]$directLines, [Predicate[string]] { param($l) $l -match 'l8db \d+\.\d+\.\d+' })
$directAfter = [array]::FindIndex([string[]]$directLines, [Predicate[string]] { param($l) $l -match 'AFTER' })
Write-Host "info typed into cmd without the starter: version at line $directVersion, AFTER at line $directAfter (AFTER first reproduces the reported hang)"
Write-Host ($directLines -join "`n")

$env:PATH = "$bin;$root;$env:PATH"
$where = Cmd 'where l8db'
Check 'PATH: cmd resolves l8db to the starter first' ((Lines $where.out)[0] -eq $shim) $where
Check 'PATH: PowerShell resolves l8db to the starter' ((Get-Command l8db).Source -eq $shim) (Get-Command l8db).Source
$byName = Cmd 'l8db version'
Check 'PATH: cmd runs l8db by name' ($byName.code -eq 0 -and $byName.out -match '^l8db ') $byName
$spawned = Run 'l8db' 'version'
Check 'PATH: programs that spawn l8db directly still find l8db.exe' ($spawned.code -eq 0 -and $spawned.out -match '^l8db ') $spawned

$dump = Join-Path $work 'dump.ps1'
$screen = Join-Path $work 'screen.txt'
@'
$raw = $Host.UI.RawUI
$last = $raw.CursorPosition.Y
$width = $raw.BufferSize.Width
$cells = $raw.GetBufferContents([Management.Automation.Host.Rectangle]::new(0, 0, $width - 1, $last))
$lines = for ($y = 0; $y -le $last; $y++) { (-join (0..($width - 1) | ForEach-Object { $cells[$y, $_].Character })).TrimEnd() }
$lines | Set-Content -Encoding utf8 $args[0]
'@ | Set-Content -Encoding utf8 $dump
try {
  $console = Start-Process cmd.exe -Wait -PassThru -ArgumentList "/d /s /c `"`"$shim`" version && echo DONE-OK & powershell -NoProfile -ExecutionPolicy Bypass -File `"$dump`" `"$screen`"`""
  $shown = if (Test-Path $screen) { Lines (Get-Content -Raw $screen) } else { @() }
  $shownVersion = [array]::FindIndex([string[]]$shown, [Predicate[string]] { param($l) $l -match 'l8db \d+\.\d+\.\d+' })
  $shownDone = [array]::FindIndex([string[]]$shown, [Predicate[string]] { param($l) $l -match 'DONE-OK' })
  Check 'real console: the version appears on screen before the shell continues' ($shownVersion -ge 0 -and $shownDone -gt $shownVersion) ($shown -join "`n")
} catch {
  Check 'real console: the version appears on screen before the shell continues' $false $_
}

Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
if ($script:failed -gt 0) {
  Write-Host "$($script:failed) check(s) failed"
  exit 1
}
Write-Host 'all checks passed'
