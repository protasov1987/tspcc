param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,
    [string]$Mysql = 'mysql',
    [string]$TargetDbHost = '',
    [int]$TargetDbPort = 0,
    [string]$TargetDbName = '',
    [string]$RestoreUser = '',
    [string]$RestorePassword = '',
    [string]$TargetCardsStoragePath = '',
    [switch]$DropAndRecreateTargetDb,
    [switch]$ClearTargetCardsStorage,
    [switch]$AllowSameDatabaseNameForTest
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Get-EnvOrDefault {
    param(
        [string]$Name,
        [string]$DefaultValue = ''
    )

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }

    return $value.Trim()
}

function Get-RequiredValue {
    param(
        [string]$Name,
        [string]$Value
    )

    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw "$Name is required."
    }
    if ($Value -match '^<.*>$') {
        throw "$Name still contains a placeholder value."
    }

    return $Value
}

function Quote-MySqlIdentifier {
    param([string]$Value)

    if ($Value -notmatch '^[A-Za-z0-9_]+$') {
        throw "Unsafe MySQL identifier: $Value"
    }

    return '`' + ($Value -replace '`', '``') + '`'
}

function Get-RelativePath {
    param(
        [string]$Root,
        [string]$Path
    )

    $rootFull = [System.IO.Path]::GetFullPath($Root).TrimEnd('\', '/')
    $pathFull = [System.IO.Path]::GetFullPath($Path)
    $rootUri = New-Object System.Uri(($rootFull + [System.IO.Path]::DirectorySeparatorChar))
    $pathUri = New-Object System.Uri($pathFull)
    return [System.Uri]::UnescapeDataString($rootUri.MakeRelativeUri($pathUri).ToString()).Replace('\', '/')
}

function Get-Sha256ForText {
    param([string]$Text)

    $sha = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
        $hash = $sha.ComputeHash($bytes)
        return (($hash | ForEach-Object { $_.ToString('x2') }) -join '')
    }
    finally {
        $sha.Dispose()
    }
}

function Get-FileSummary {
    param([string]$Root)

    $files = @(Get-ChildItem -LiteralPath $Root -File -Recurse | Sort-Object FullName)
    $entries = @()
    [Int64]$totalBytes = 0

    foreach ($file in $files) {
        $relativePath = Get-RelativePath -Root $Root -Path $file.FullName
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $totalBytes += [Int64]$file.Length
        $entries += "$relativePath`t$($file.Length)`t$hash"
    }

    return [ordered]@{
        fileCount = $files.Count
        totalBytes = $totalBytes
        aggregateSha256 = Get-Sha256ForText -Text ($entries -join "`n")
    }
}

function Assert-RestoreEnvironment {
    $restoreEnv = Get-EnvOrDefault -Name 'TSPCC_RESTORE_ENV'
    if (@('local', 'test') -notcontains $restoreEnv) {
        throw 'TSPCC_RESTORE_ENV must be local or test before restore rehearsal can run.'
    }
}

function Assert-SafeTargetStorageClear {
    param([string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $safeRoot = [System.IO.Path]::GetFullPath((Join-Path $repoRoot 'data\restore-rehearsals'))
    if (-not $fullPath.StartsWith($safeRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to clear target storage outside data/restore-rehearsals: $fullPath"
    }
}

function Invoke-MySqlCommand {
    param(
        [string]$Sql,
        [string]$Database = ''
    )

    $args = @(
        "--host=$TargetDbHost",
        "--port=$TargetDbPort",
        "--user=$RestoreUser",
        '--batch',
        '--raw',
        "--execute=$Sql"
    )
    if (-not [string]::IsNullOrWhiteSpace($Database)) {
        $args += "--database=$Database"
    }

    $previousMysqlPwd = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
    try {
        $env:MYSQL_PWD = $RestorePassword
        $output = & $Mysql @args
        if ($LASTEXITCODE -ne 0) {
            throw "mysql command failed with exit code $LASTEXITCODE."
        }
        return @($output | ForEach-Object { "$_" })
    }
    finally {
        if ($null -eq $previousMysqlPwd) {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        }
        else {
            $env:MYSQL_PWD = $previousMysqlPwd
        }
    }
}

function ConvertTo-ProcessArgument {
    param([string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"'
}

function Invoke-MySqlFile {
    param([string]$SqlPath)

    $args = @(
        "--host=$TargetDbHost",
        "--port=$TargetDbPort",
        "--user=$RestoreUser",
        "--database=$TargetDbName",
        '--default-character-set=utf8mb4'
    )

    $previousMysqlPwd = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
    $process = New-Object System.Diagnostics.Process
    try {
        $env:MYSQL_PWD = $RestorePassword
        $process.StartInfo.FileName = $Mysql
        $process.StartInfo.Arguments = ($args | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join ' '
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.RedirectStandardInput = $true
        [void]$process.Start()

        $reader = [System.IO.File]::OpenText($SqlPath)
        try {
            $buffer = New-Object char[] 65536
            while (($read = $reader.Read($buffer, 0, $buffer.Length)) -gt 0) {
                $process.StandardInput.Write($buffer, 0, $read)
            }
        }
        finally {
            $reader.Dispose()
            $process.StandardInput.Close()
        }

        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "mysql restore failed with exit code $($process.ExitCode)."
        }
    }
    finally {
        if (-not $process.HasExited) {
            $process.Kill()
        }
        $process.Dispose()
        if ($null -eq $previousMysqlPwd) {
            Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
        }
        else {
            $env:MYSQL_PWD = $previousMysqlPwd
        }
    }
}

Assert-RestoreEnvironment

$manifestFullPath = (Resolve-Path -LiteralPath $ManifestPath).Path
$backupDir = Split-Path -Parent $manifestFullPath
$manifest = Get-Content -LiteralPath $manifestFullPath -Raw | ConvertFrom-Json

if ([string]::IsNullOrWhiteSpace($TargetDbHost)) {
    $TargetDbHost = Get-EnvOrDefault -Name 'TSPCC_DB_HOST' -DefaultValue '127.0.0.1'
}
if ($TargetDbPort -le 0) {
    $dbPortText = Get-EnvOrDefault -Name 'TSPCC_DB_PORT' -DefaultValue '3306'
    if (-not [int]::TryParse($dbPortText, [ref]$TargetDbPort) -or $TargetDbPort -le 0) {
        throw "TSPCC_DB_PORT must be a positive integer. Current value: $dbPortText"
    }
}
if ([string]::IsNullOrWhiteSpace($TargetDbName)) {
    $TargetDbName = Get-EnvOrDefault -Name 'TSPCC_DB_RESTORE_NAME' -DefaultValue 'tspcc_bd_restore'
}
if ([string]::IsNullOrWhiteSpace($RestoreUser)) {
    $RestoreUser = Get-EnvOrDefault -Name 'TSPCC_DB_RESTORE_USER' -DefaultValue (Get-EnvOrDefault -Name 'TSPCC_DB_MIGRATION_USER')
}
if ([string]::IsNullOrWhiteSpace($RestorePassword)) {
    $RestorePassword = Get-EnvOrDefault -Name 'TSPCC_DB_RESTORE_PASSWORD' -DefaultValue (Get-EnvOrDefault -Name 'TSPCC_DB_MIGRATION_PASSWORD')
}
$RestoreUser = Get-RequiredValue -Name 'TSPCC_DB_RESTORE_USER or TSPCC_DB_MIGRATION_USER' -Value $RestoreUser
$RestorePassword = Get-RequiredValue -Name 'TSPCC_DB_RESTORE_PASSWORD or TSPCC_DB_MIGRATION_PASSWORD' -Value $RestorePassword

$sourceDbName = [string]$manifest.mysql.database
if ($TargetDbName -eq $sourceDbName -and -not $AllowSameDatabaseNameForTest) {
    throw "Target DB '$TargetDbName' matches source DB '$sourceDbName'. Use a separate test DB or pass -AllowSameDatabaseNameForTest only on an isolated local/test server."
}

if ([string]::IsNullOrWhiteSpace($TargetCardsStoragePath)) {
    $TargetCardsStoragePath = Join-Path $repoRoot ("data\restore-rehearsals\$($manifest.backupSetId)\cards")
}

$sqlDumpPath = Join-Path $backupDir ([string]$manifest.artifacts.sqlDump.fileName)
$fileArchivePath = Join-Path $backupDir ([string]$manifest.artifacts.fileArchive.fileName)
if (-not (Test-Path -LiteralPath $sqlDumpPath -PathType Leaf)) {
    throw "SQL dump is missing: $sqlDumpPath"
}
if (-not (Test-Path -LiteralPath $fileArchivePath -PathType Leaf)) {
    throw "File archive is missing: $fileArchivePath"
}

if ($DropAndRecreateTargetDb) {
    $dbIdentifier = Quote-MySqlIdentifier -Value $TargetDbName
    Invoke-MySqlCommand -Sql "DROP DATABASE IF EXISTS $dbIdentifier; CREATE DATABASE $dbIdentifier CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;" | Out-Null
}

Invoke-MySqlFile -SqlPath $sqlDumpPath
$tableCountOutput = Invoke-MySqlCommand -Database $TargetDbName -Sql 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();'
$tableCount = ($tableCountOutput | Select-Object -Last 1)

if (Test-Path -LiteralPath $TargetCardsStoragePath) {
    $existingChildren = @(Get-ChildItem -LiteralPath $TargetCardsStoragePath -Force)
    if ($existingChildren.Count -gt 0) {
        if (-not $ClearTargetCardsStorage) {
            throw "Target card storage is not empty. Pass -ClearTargetCardsStorage for data/restore-rehearsals targets or choose an empty path: $TargetCardsStoragePath"
        }
        Assert-SafeTargetStorageClear -Path $TargetCardsStoragePath
        Remove-Item -LiteralPath $TargetCardsStoragePath -Recurse -Force
    }
}
New-Item -ItemType Directory -Path $TargetCardsStoragePath -Force | Out-Null

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory($fileArchivePath, $TargetCardsStoragePath)

$restoredSummary = Get-FileSummary -Root $TargetCardsStoragePath
$expectedSummary = $manifest.fileSummary
if ([int64]$restoredSummary.fileCount -ne [int64]$expectedSummary.fileCount `
    -or [int64]$restoredSummary.totalBytes -ne [int64]$expectedSummary.totalBytes `
    -or [string]$restoredSummary.aggregateSha256 -ne [string]$expectedSummary.aggregateSha256) {
    throw 'Restored file storage summary does not match backup manifest.'
}

$reportPath = Join-Path (Split-Path -Parent $TargetCardsStoragePath) 'restore-rehearsal-report.json'
$report = [ordered]@{
    manifest = $manifestFullPath
    restoredAtUtc = [DateTimeOffset]::UtcNow.ToString('o')
    target = [ordered]@{
        environment = Get-EnvOrDefault -Name 'TSPCC_RESTORE_ENV'
        database = $TargetDbName
        cardsStoragePath = (Resolve-Path -LiteralPath $TargetCardsStoragePath).Path
    }
    verification = [ordered]@{
        sqlRestored = $true
        restoredTableCount = $tableCount
        filesRestored = $true
        fileCount = $restoredSummary.fileCount
        totalBytes = $restoredSummary.totalBytes
        aggregateSha256 = $restoredSummary.aggregateSha256
        fileMetadataMatchesPhysicalFiles = 'pending Stage 4 SQL attachment metadata reconciliation'
    }
}
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $reportPath -Encoding UTF8

Write-Output "[DB] Restore rehearsal completed for manifest: $manifestFullPath"
Write-Output "[DB] Restore rehearsal report: $reportPath"
