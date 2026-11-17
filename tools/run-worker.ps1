#requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('codex', 'agy')]
    [string]$Worker,

    [Parameter(Mandatory = $true)]
    [string]$Task,

    [string]$Model
)

$ErrorActionPreference = 'Stop'
$Worker = $Worker.ToLowerInvariant()
$root = Split-Path -Parent $PSScriptRoot
$outDirectory = Join-Path $root 'out'
$logDirectory = Join-Path $outDirectory 'logs'
$statusPath = Join-Path $outDirectory 'worker-status.json'
$utf8 = New-Object System.Text.UTF8Encoding($false)
[void][System.IO.Directory]::CreateDirectory($logDirectory)

function Save-WorkerRun {
    param([Parameter(Mandatory = $true)]$Run)

    $mutex = New-Object System.Threading.Mutex($false, 'WorkerStatusLock')
    $locked = $false
    $temporaryPath = $null
    try {
        try {
            $locked = $mutex.WaitOne()
        }
        catch [System.Threading.AbandonedMutexException] {
            # An abandoned mutex is still acquired by this thread.
            $locked = $true
        }

        $runs = @()
        if (Test-Path -LiteralPath $statusPath) {
            try {
                $existing = [System.IO.File]::ReadAllText($statusPath, $utf8) | ConvertFrom-Json
                if ($null -eq $existing -or
                    $null -eq $existing.PSObject.Properties['runs'] -or
                    $existing.runs -isnot [System.Array]) {
                    throw 'Invalid worker status structure.'
                }
                $runs = @($existing.runs | Where-Object { $null -ne $_ -and $_.id -ne $Run.id })
            }
            catch {
                # Missing/invalid JSON or an invalid structure starts a new history.
                $runs = @()
            }
        }

        # Sort-Object cannot see keys of an ordered hashtable; make it an object first.
        $runs = @(@($runs) + @([pscustomobject]$Run) | Sort-Object -Property start -Descending | Select-Object -First 20)
        $document = [ordered]@{
            updated = [DateTimeOffset]::UtcNow.ToString('o')
            runs = @($runs)
        }
        $temporaryPath = Join-Path $outDirectory ('worker-status.{0}.tmp' -f [Guid]::NewGuid().ToString('N'))
        [System.IO.File]::WriteAllText($temporaryPath, ($document | ConvertTo-Json -Depth 10), $utf8)
        Move-Item -LiteralPath $temporaryPath -Destination $statusPath -Force
    }
    finally {
        if ($null -ne $temporaryPath -and (Test-Path -LiteralPath $temporaryPath)) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
        if ($locked) { $mutex.ReleaseMutex() }
        $mutex.Dispose()
    }
}

$start = [DateTimeOffset]::UtcNow
$id = '{0}-{1}' -f $start.ToString('yyyyMMddTHHmmssfffZ'), [Guid]::NewGuid().ToString('N').Substring(0, 4)
$relativeLog = 'out/logs/{0}.log' -f $id
$logPath = Join-Path $logDirectory ($id + '.log')
$run = [ordered]@{
    id = $id
    worker = $Worker
    model = $(if ($Model) { $Model } elseif ($Worker -eq 'agy') { 'default' } else { $null })
    # Long enough to keep the output path most tasks name near their end.
    task = $Task.Substring(0, [Math]::Min(400, $Task.Length))
    status = 'running'
    start = $start.ToString('o')
    end = $null
    seconds = $null
    tokens = $null
    log = $relativeLog
}

# Persist the running record before resolving or invoking the worker.
Save-WorkerRun -Run $run
$stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
$exitCode = 1
$writer = $null
$previousOutputEncoding = $OutputEncoding
try {
    $writer = New-Object System.IO.StreamWriter($logPath, $false, $utf8)
    $writer.AutoFlush = $true
    $command = Get-Command -Name $Worker -CommandType Application, ExternalScript -ErrorAction Stop | Select-Object -First 1
    $workerArguments = @()
    if ($Worker -eq 'codex') {
        $workerArguments = @('exec', '--skip-git-repo-check', '--sandbox', 'workspace-write')
        if ($Model) { $workerArguments += @('-m', $Model) }
        $workerArguments += '-'
    }
    else {
        # Windows PowerShell 5.1 removes unescaped quotes in native arguments.
        $escapedTask = $Task.Replace('"', '\"')
        # JSON output carries the run's status and token usage (but not the model name).
        $workerArguments = @('-p', $escapedTask, '--output-format', 'json')
        if ($Model) { $workerArguments += @('--model', $Model) }
    }

    # Native stderr is emitted as ErrorRecord objects in Windows PowerShell 5.1.
    # Continue lets us capture it without treating normal stderr as a launch failure.
    $ErrorActionPreference = 'Continue'
    $OutputEncoding = $utf8
    # Assigning plain $LASTEXITCODE would create a script-scoped copy that native commands never update.
    $global:LASTEXITCODE = 0
    if ($Worker -eq 'codex') {
        $Task | & $command @workerArguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            $writer.WriteLine($line)
            Write-Host $line
            # Codex names its model in the header; publish it while the run is still going.
            if ($null -eq $run.model -and $line -match '^\s*model:\s*(\S+)') {
                $run.model = $Matches[1]
                try { Save-WorkerRun -Run $run } catch { }
            }
        }
    }
    else {
        & $command @workerArguments 2>&1 | ForEach-Object {
            $line = $_.ToString()
            $writer.WriteLine($line)
            Write-Host $line
        }
    }
    $exitCode = $global:LASTEXITCODE
}
catch {
    $exitCode = 1
    $message = $_.ToString()
    if ($null -ne $writer) { $writer.WriteLine($message) }
    Write-Host $message
}
finally {
    $ErrorActionPreference = 'Stop'
    $OutputEncoding = $previousOutputEncoding
    $stopwatch.Stop()
    if ($null -ne $writer) { $writer.Dispose() }
}

$run.status = $(if ($exitCode -eq 0) { 'done' } else { 'failed' })
$run.end = [DateTimeOffset]::UtcNow.ToString('o')
$run.seconds = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 3)
try {
    if ($Worker -eq 'codex' -and (Test-Path -LiteralPath $logPath)) {
        $lines = [System.IO.File]::ReadAllLines($logPath, $utf8)
        for ($i = 0; $i -lt $lines.Length; $i++) {
            if ($lines[$i] -match '^\s*model:\s*(\S+)') {
                $run.model = $Matches[1]
            }
            if ($lines[$i] -match '^\s*tokens used\s*$') {
                # stdout and stderr interleave, so the final message can land between the label and the number.
                for ($j = $i + 1; $j -lt [Math]::Min($i + 6, $lines.Length); $j++) {
                    if ($lines[$j] -match '^\s*([\d,]+)\s*$') {
                        $tokenCount = 0L
                        if ([long]::TryParse($Matches[1].Replace(',', ''), [ref]$tokenCount)) {
                            $run.tokens = $tokenCount
                        }
                        break
                    }
                }
            }
        }
    }
    if ($Worker -eq 'agy' -and (Test-Path -LiteralPath $logPath)) {
        $jsonLine = [System.IO.File]::ReadAllLines($logPath, $utf8) |
            Where-Object { $_ -match '^\s*\{.*"status"' } | Select-Object -Last 1
        if ($jsonLine) {
            try {
                $result = $jsonLine | ConvertFrom-Json
                if ($null -ne $result.usage -and $null -ne $result.usage.total_tokens) {
                    $run.tokens = [long]$result.usage.total_tokens
                }
                if ($result.status -and $result.status -ne 'SUCCESS') { $run.status = 'failed' }
            }
            catch {
                # Not the JSON we expected; keep the exit-code status.
            }
        }
    }
}
finally {
    try { Save-WorkerRun -Run $run }
    catch { Write-Warning ('Could not save final worker status: {0}' -f $_) }
}

exit $exitCode
