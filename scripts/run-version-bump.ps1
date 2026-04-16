$ErrorActionPreference = 'Stop'

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$nodeScriptPath = Join-Path $repoRoot 'scripts\bump-app-version.js'

$docOnlyExactPaths = @(
    'AGENTS.md',
    'README.md',
    'REPO_ANALYSIS.md',
    'scripts/generate_user_manual.py'
)
$docOnlyPrefixes = @(
    'docs/'
)
$nonSiteExactPaths = @(
    '.gitattributes',
    '.gitignore'
)
$nonSitePrefixes = @(
    '.github/'
)
$siteExactPaths = @(
    'app-version.json',
    'barcodeScanner.js',
    'dashboard.js',
    'db.js',
    'deploy.sh',
    'ecosystem.config.js',
    'favicon.svg',
    'funny-intro-small.webp',
    'generateCode128Svg.js',
    'generateQrSvg.js',
    'index.html',
    'manifest.webmanifest',
    'package-lock.json',
    'package.json',
    'server.js',
    'style.css',
    'style_tabs.css',
    'sw.js'
)
$sitePrefixes = @(
    'icons/',
    'js/',
    'scripts/',
    'server/',
    'templates/'
)

function Normalize-RepoPath {
    param([string]$PathValue)

    if ($null -eq $PathValue) {
        return ''
    }

    return ($PathValue.Trim() -replace '\\', '/')
}

function Read-ChangeDescription {
    param([string[]]$CliArgs)

    for ($index = 0; $index -lt $CliArgs.Count; $index += 1) {
        $token = [string]$CliArgs[$index]
        if ($token -eq '--change' -and ($index + 1) -lt $CliArgs.Count) {
            return [string]$CliArgs[$index + 1]
        }
        if ($token.StartsWith('--change=')) {
            return $token.Substring('--change='.Length)
        }
    }

    return ''
}

function Invoke-Git {
    param([string[]]$Arguments)

    $stderrPath = [System.IO.Path]::GetTempFileName()
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & git @Arguments 2> $stderrPath
        $ErrorActionPreference = $previousErrorActionPreference
        $stderrLines = @()
        if (Test-Path $stderrPath) {
            $stderrLines = @(Get-Content $stderrPath)
        }

        if ($LASTEXITCODE -ne 0) {
            $details = (($stderrLines + $output) | ForEach-Object { "$_" }) -join [Environment]::NewLine
            throw "Git command failed: git $($Arguments -join ' ')`n$details"
        }

        return @($output | ForEach-Object { "$_" })
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
        if (Test-Path $stderrPath) {
            Remove-Item -LiteralPath $stderrPath -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-ChangedPaths {
    $paths = New-Object 'System.Collections.Generic.HashSet[string]'
    $commands = @(
        @('diff', '--name-only'),
        @('diff', '--cached', '--name-only'),
        @('ls-files', '--others', '--exclude-standard')
    )

    foreach ($command in $commands) {
        foreach ($line in (Invoke-Git -Arguments $command)) {
            $normalized = Normalize-RepoPath $line
            if (-not [string]::IsNullOrWhiteSpace($normalized)) {
                [void]$paths.Add($normalized)
            }
        }
    }

    return @($paths)
}

function Get-PathCategory {
    param([string]$RepoPath)

    $normalized = Normalize-RepoPath $RepoPath
    if ([string]::IsNullOrWhiteSpace($normalized)) {
        return 'unknown'
    }

    if ($normalized -eq 'docs/help.html') {
        return 'site'
    }

    if ($docOnlyExactPaths -contains $normalized) {
        return 'doc-only'
    }
    foreach ($prefix in $docOnlyPrefixes) {
        if ($normalized.StartsWith($prefix)) {
            return 'doc-only'
        }
    }

    if ($nonSiteExactPaths -contains $normalized) {
        return 'non-site'
    }
    foreach ($prefix in $nonSitePrefixes) {
        if ($normalized.StartsWith($prefix)) {
            return 'non-site'
        }
    }

    if ($siteExactPaths -contains $normalized) {
        return 'site'
    }
    foreach ($prefix in $sitePrefixes) {
        if ($normalized.StartsWith($prefix)) {
            return 'site'
        }
    }

    return 'unknown'
}

function Assert-SiteChangesExist {
    param([string[]]$ChangedPaths)

    if (-not $ChangedPaths -or $ChangedPaths.Count -eq 0) {
        throw 'No project changes detected. Version bump is allowed only when site files changed.'
    }

    $sitePaths = @()
    $docOnlyPaths = @()
    $nonSitePaths = @()
    $unknownPaths = @()

    foreach ($filePath in $ChangedPaths) {
        switch (Get-PathCategory $filePath) {
            'site' { $sitePaths += $filePath }
            'doc-only' { $docOnlyPaths += $filePath }
            'non-site' { $nonSitePaths += $filePath }
            default { $unknownPaths += $filePath }
        }
    }

    if ($unknownPaths.Count -gt 0) {
        $details = ($unknownPaths | ForEach-Object { "- $_" }) -join [Environment]::NewLine
        throw "Unknown changed paths found. Classify them before bumping the version.`n$details"
    }

    if ($sitePaths.Count -eq 0) {
        $details = (($docOnlyPaths + $nonSitePaths) | ForEach-Object { "- $_" }) -join [Environment]::NewLine
        if ([string]::IsNullOrWhiteSpace($details)) {
            $details = 'No eligible site files were changed.'
        }
        throw "No site file changes detected. Version bump is required only for site files.`n$details"
    }
}

function Get-PreviewMetadata {
    param(
        [string]$ChangeDescription,
        [string]$TimestampIso
    )

    $output = & node $nodeScriptPath --preview --change $ChangeDescription --timestamp $TimestampIso
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to build version bump preview metadata.'
    }

    return ($output -join '') | ConvertFrom-Json
}

function Invoke-NodeApply {
    param(
        [string]$ChangeDescription,
        [string]$TimestampIso
    )

    $null = & node $nodeScriptPath --change $ChangeDescription --timestamp $TimestampIso
    if ($LASTEXITCODE -ne 0) {
        throw 'Node version bump apply step failed.'
    }
}

Set-Location $repoRoot

$changeDescription = Read-ChangeDescription -CliArgs $args
if ([string]::IsNullOrWhiteSpace($changeDescription)) {
    throw 'Change description is required. Use --change "<short description>"'
}

$changedPaths = Get-ChangedPaths
Assert-SiteChangesExist -ChangedPaths $changedPaths

$timestampIso = [DateTimeOffset]::Now.ToString('o')
$preview = Get-PreviewMetadata -ChangeDescription $changeDescription -TimestampIso $timestampIso

$existingBranch = Invoke-Git -Arguments @('branch', '--list', $preview.backupBranchName)
if ($existingBranch.Count -gt 0) {
    throw "Local backup branch '$($preview.backupBranchName)' already exists."
}

Invoke-NodeApply -ChangeDescription $changeDescription -TimestampIso $timestampIso

try {
    Invoke-Git -Arguments @('switch', '-c', $preview.backupBranchName) | Out-Null
    Invoke-Git -Arguments @('add', '-A', '--', '.') | Out-Null
    Invoke-Git -Arguments @('commit', '-m', $preview.commitMessage) | Out-Null
}
catch {
    throw "Version bump completed, but local backup commit failed.`nBranch: $($preview.backupBranchName)`n$($_.Exception.Message)"
}

$commitSha = (Invoke-Git -Arguments @('rev-parse', '--short', 'HEAD') | Select-Object -First 1).Trim()

Write-Output $preview.footer
Write-Output "Local backup branch: $($preview.backupBranchName)"
Write-Output "Local backup commit: $commitSha"
Write-Output "Version log entry: $($preview.versionLogEntry.version) $($preview.versionLogEntry.date) $($preview.versionLogEntry.time)"
