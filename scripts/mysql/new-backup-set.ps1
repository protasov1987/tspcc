param(
    [string]$MysqlDump = 'mysqldump',
    [string]$OutputRoot = '',
    [string]$BackupId = '',
    [string]$DbHost = '',
    [int]$DbPort = 0,
    [string]$DbName = '',
    [string]$DbUser = '',
    [string]$DbPassword = '',
    [string]$DataPath = '',
    [string]$CardsStoragePath = '',
    [string]$SchemaMigrationVersion = 'stage1-placeholder-no-schema-runner-yet'
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

function Resolve-DataFilePath {
    param([string]$ExplicitPath)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $candidate = $ExplicitPath
    }
    else {
        $envDataDir = Get-EnvOrDefault -Name 'TSPCC_DATA_DIR'
        if (-not [string]::IsNullOrWhiteSpace($envDataDir)) {
            $candidate = $envDataDir
        }
        else {
            $candidate = Join-Path $repoRoot 'data\database.json'
        }
    }

    if (Test-Path -LiteralPath $candidate -PathType Container) {
        $candidate = Join-Path $candidate 'database.json'
    }

    if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        throw "Data file does not exist: $candidate"
    }

    return (Resolve-Path -LiteralPath $candidate).Path
}

function Resolve-CardsStorageRoot {
    param([string]$ExplicitPath)

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $candidate = $ExplicitPath
    }
    else {
        $envStorageDir = Get-EnvOrDefault -Name 'TSPCC_STORAGE_DIR'
        if (-not [string]::IsNullOrWhiteSpace($envStorageDir)) {
            $cardsChild = Join-Path $envStorageDir 'cards'
            if (Test-Path -LiteralPath $cardsChild -PathType Container) {
                $candidate = $cardsChild
            }
            else {
                $candidate = $envStorageDir
            }
        }
        else {
            $candidate = Join-Path $repoRoot 'storage\cards'
        }
    }

    if (-not (Test-Path -LiteralPath $candidate -PathType Container)) {
        throw "Card file storage root does not exist: $candidate"
    }

    return (Resolve-Path -LiteralPath $candidate).Path
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
        $entries += [ordered]@{
            path = $relativePath
            size = [Int64]$file.Length
            sha256 = $hash
        }
    }

    $aggregateText = ($entries | ForEach-Object { "$($_.path)`t$($_.size)`t$($_.sha256)" }) -join "`n"

    return [ordered]@{
        fileCount = $files.Count
        totalBytes = $totalBytes
        checksumAlgorithm = 'SHA256'
        aggregateSha256 = Get-Sha256ForText -Text $aggregateText
        entries = $entries
    }
}

function New-ZipFromDirectory {
    param(
        [string]$SourceDir,
        [string]$ArchivePath
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($ArchivePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $files = @(Get-ChildItem -LiteralPath $SourceDir -File -Recurse | Sort-Object FullName)
        foreach ($file in $files) {
            $entryName = Get-RelativePath -Root $SourceDir -Path $file.FullName
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive,
                $file.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Get-ArtifactInfo {
    param(
        [string]$Path,
        [string]$BaseDir
    )

    $item = Get-Item -LiteralPath $Path
    return [ordered]@{
        fileName = Get-RelativePath -Root $BaseDir -Path $item.FullName
        size = [Int64]$item.Length
        sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
}

function Get-AppVersionInfo {
    $versionPath = Join-Path $repoRoot 'app-version.json'
    $version = Get-Content -LiteralPath $versionPath -Raw | ConvertFrom-Json
    $label = '{0} {1}.{2:00}.{3:00}' -f $version.stage, [int]$version.major, [int]$version.minor, [int]$version.patch
    return [ordered]@{
        label = $label
        sourceFile = 'app-version.json'
        raw = $version
    }
}

function Get-GitInfo {
    $commit = ''
    $dirty = $null
    try {
        $commit = ((& git rev-parse HEAD) | Select-Object -First 1).Trim()
        $dirtyLines = @(& git status --porcelain)
        $dirty = ($dirtyLines.Count -gt 0)
    }
    catch {
        $commit = 'unavailable'
        $dirty = $null
    }

    return [ordered]@{
        commit = $commit
        dirty = $dirty
    }
}

if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRoot 'data\mysql-backups'
}
if ([string]::IsNullOrWhiteSpace($BackupId)) {
    $BackupId = 'mysql84-' + [DateTimeOffset]::UtcNow.ToString('yyyyMMddTHHmmssZ')
}

if ([string]::IsNullOrWhiteSpace($DbHost)) {
    $DbHost = Get-EnvOrDefault -Name 'TSPCC_DB_HOST' -DefaultValue '127.0.0.1'
}
if ($DbPort -le 0) {
    $dbPortText = Get-EnvOrDefault -Name 'TSPCC_DB_PORT' -DefaultValue '3306'
    if (-not [int]::TryParse($dbPortText, [ref]$DbPort) -or $DbPort -le 0) {
        throw "TSPCC_DB_PORT must be a positive integer. Current value: $dbPortText"
    }
}
if ([string]::IsNullOrWhiteSpace($DbName)) {
    $DbName = Get-EnvOrDefault -Name 'TSPCC_DB_NAME' -DefaultValue 'tspcc_bd'
}
if ([string]::IsNullOrWhiteSpace($DbUser)) {
    $DbUser = Get-EnvOrDefault -Name 'TSPCC_DB_USER' -DefaultValue 'tspcc_app'
}
if ([string]::IsNullOrWhiteSpace($DbPassword)) {
    $DbPassword = Get-EnvOrDefault -Name 'TSPCC_DB_PASSWORD'
}
$DbPassword = Get-RequiredValue -Name 'TSPCC_DB_PASSWORD' -Value $DbPassword

$dataFile = Resolve-DataFilePath -ExplicitPath $DataPath
$cardsStorageRoot = Resolve-CardsStorageRoot -ExplicitPath $CardsStoragePath

$backupDir = Join-Path $OutputRoot $BackupId
if (Test-Path -LiteralPath $backupDir) {
    throw "Backup set directory already exists: $backupDir"
}
New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

$timestampUtc = [DateTimeOffset]::UtcNow.ToString('o')
$sqlDumpPath = Join-Path $backupDir "$BackupId.sql"
$fileArchivePath = Join-Path $backupDir "$BackupId-card-files.zip"
$checksumPath = Join-Path $backupDir "$BackupId-file-checksums.json"
$manifestPath = Join-Path $backupDir "$BackupId-manifest.json"

$dumpArgs = @(
    "--host=$DbHost",
    "--port=$DbPort",
    "--user=$DbUser",
    '--single-transaction',
    '--routines',
    '--triggers',
    '--events',
    '--hex-blob',
    '--default-character-set=utf8mb4',
    '--set-gtid-purged=OFF',
    '--no-tablespaces',
    "--result-file=$sqlDumpPath",
    $DbName
)

$previousMysqlPwd = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
try {
    $env:MYSQL_PWD = $DbPassword
    & $MysqlDump @dumpArgs
    if ($LASTEXITCODE -ne 0) {
        throw "mysqldump failed with exit code $LASTEXITCODE."
    }
}
finally {
    if ($null -eq $previousMysqlPwd) {
        Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    }
    else {
        $env:MYSQL_PWD = $previousMysqlPwd
    }
}

$fileSummary = Get-FileSummary -Root $cardsStorageRoot
$checksumDocument = [ordered]@{
    backupSetId = $BackupId
    generatedAtUtc = $timestampUtc
    sourceRoot = $cardsStorageRoot
    summary = [ordered]@{
        fileCount = $fileSummary.fileCount
        totalBytes = $fileSummary.totalBytes
        checksumAlgorithm = $fileSummary.checksumAlgorithm
        aggregateSha256 = $fileSummary.aggregateSha256
    }
    files = $fileSummary.entries
}
$checksumDocument | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $checksumPath -Encoding UTF8

New-ZipFromDirectory -SourceDir $cardsStorageRoot -ArchivePath $fileArchivePath

$dataItem = Get-Item -LiteralPath $dataFile
$manifest = [ordered]@{
    backupSetId = $BackupId
    timestampUtc = $timestampUtc
    stage = 'mysql-84-stage1-batch3'
    app = Get-AppVersionInfo
    git = Get-GitInfo
    mysql = [ordered]@{
        host = $DbHost
        port = $DbPort
        database = $DbName
        dumpTool = $MysqlDump
    }
    schemaMigrationVersion = [ordered]@{
        value = $SchemaMigrationVersion
        status = 'placeholder until Stage 3 migration runner exists'
    }
    domainCounts = [ordered]@{
        status = 'placeholder until Stage 2/3 SQL schema and import reconciliation exist'
        note = 'Populate with domain counts after schema migrations and dry-run import are available.'
    }
    sources = [ordered]@{
        data = [ordered]@{
            envVar = 'TSPCC_DATA_DIR'
            path = $dataFile
            size = [Int64]$dataItem.Length
            sha256 = (Get-FileHash -LiteralPath $dataFile -Algorithm SHA256).Hash.ToLowerInvariant()
        }
        cardFiles = [ordered]@{
            envVar = 'TSPCC_STORAGE_DIR'
            path = $cardsStorageRoot
        }
    }
    artifacts = [ordered]@{
        sqlDump = Get-ArtifactInfo -Path $sqlDumpPath -BaseDir $backupDir
        fileArchive = Get-ArtifactInfo -Path $fileArchivePath -BaseDir $backupDir
        fileChecksums = Get-ArtifactInfo -Path $checksumPath -BaseDir $backupDir
    }
    fileSummary = [ordered]@{
        fileCount = $fileSummary.fileCount
        totalBytes = $fileSummary.totalBytes
        checksumAlgorithm = $fileSummary.checksumAlgorithm
        aggregateSha256 = $fileSummary.aggregateSha256
    }
    retentionBaseline = [ordered]@{
        minimum = 'daily full logical dump plus matching card file archive'
        retentionDays = 14
        note = 'Do not reduce below 14 days unless a later operations decision changes the baseline.'
    }
    rpoRtoBaseline = [ordered]@{
        rpo = '24h until a stricter operational schedule is approved'
        rto = '2-4h until restore rehearsal provides measured numbers'
    }
    completenessRule = 'Backup set is complete only when sqlDump, fileArchive, fileChecksums, and manifest are present and hashes match.'
}

$manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Output "[DB] MySQL backup set created: $backupDir"
Write-Output "[DB] Manifest: $manifestPath"
