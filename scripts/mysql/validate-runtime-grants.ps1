param(
    [string]$Mysql = 'mysql',
    [switch]$ProbeDdl
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0

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

function Get-RequiredEnv {
    param([string]$Name)

    $value = Get-EnvOrDefault -Name $Name
    if ([string]::IsNullOrWhiteSpace($value)) {
        throw "$Name is required."
    }
    if ($value -match '^<.*>$') {
        throw "$Name still contains a placeholder value."
    }

    return $value
}

function Invoke-MySqlRuntime {
    param([string]$Sql)

    $args = @(
        "--host=$dbHost",
        "--port=$dbPort",
        "--user=$runtimeUser",
        '--batch',
        '--raw',
        '--skip-column-names',
        "--database=$dbName",
        "--execute=$Sql"
    )

    $previousMysqlPwd = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
    try {
        $env:MYSQL_PWD = $runtimePassword
        $output = & $Mysql @args 2>&1
        $exitCode = $LASTEXITCODE
        return @{
            ExitCode = $exitCode
            Output = @($output | ForEach-Object { "$_" })
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
}

$dbHost = Get-EnvOrDefault -Name 'TSPCC_DB_HOST' -DefaultValue '127.0.0.1'
$dbPortText = Get-EnvOrDefault -Name 'TSPCC_DB_PORT' -DefaultValue '3306'
$dbName = Get-EnvOrDefault -Name 'TSPCC_DB_NAME' -DefaultValue 'tspcc_bd'
$runtimeUser = Get-EnvOrDefault -Name 'TSPCC_DB_USER' -DefaultValue 'tspcc_app'
$runtimePassword = Get-RequiredEnv -Name 'TSPCC_DB_PASSWORD'
$migrationUser = Get-RequiredEnv -Name 'TSPCC_DB_MIGRATION_USER'
$null = Get-RequiredEnv -Name 'TSPCC_DB_MIGRATION_PASSWORD'

[int]$dbPort = 0
if (-not [int]::TryParse($dbPortText, [ref]$dbPort) -or $dbPort -le 0) {
    throw "TSPCC_DB_PORT must be a positive integer. Current value: $dbPortText"
}

if ($runtimeUser -ne 'tspcc_app') {
    throw "TSPCC_DB_USER must be tspcc_app for the Stage 1 contract. Current value: $runtimeUser"
}

if ($migrationUser -eq $runtimeUser) {
    throw 'TSPCC_DB_MIGRATION_USER must be separate from TSPCC_DB_USER.'
}

$selectCheck = Invoke-MySqlRuntime -Sql 'SELECT 1;'
if ($selectCheck.ExitCode -ne 0) {
    throw "Runtime user cannot connect/select.`n$($selectCheck.Output -join [Environment]::NewLine)"
}

$grantsCheck = Invoke-MySqlRuntime -Sql 'SHOW GRANTS;'
if ($grantsCheck.ExitCode -ne 0) {
    throw "Unable to read runtime grants.`n$($grantsCheck.Output -join [Environment]::NewLine)"
}

$grantLines = @($grantsCheck.Output | ForEach-Object { "$_".ToUpperInvariant() })
$grantsText = ($grantLines -join "`n")
$forbiddenPatterns = @(
    'GRANT ALL',
    'CREATE',
    'ALTER',
    'DROP',
    'INDEX',
    'REFERENCES',
    'GRANT OPTION'
)

$violations = @()
foreach ($pattern in $forbiddenPatterns) {
    if ($grantsText.Contains($pattern)) {
        $violations += $pattern
    }
}

if ($violations.Count -gt 0) {
    $details = ($violations | Sort-Object -Unique) -join ', '
    throw "Runtime user has forbidden grant pattern(s): $details"
}

$globalGrantViolations = @(
    $grantLines | Where-Object {
        $_.Contains(' ON *.* ') -and -not $_.StartsWith('GRANT USAGE ON *.* ')
    }
)

if ($globalGrantViolations.Count -gt 0) {
    throw "Runtime user has global grants outside USAGE.`n$($globalGrantViolations -join [Environment]::NewLine)"
}

if ($ProbeDdl) {
    $probeName = '__tspcc_runtime_grant_probe'
    $ddlChecks = @(
        "CREATE TABLE $probeName (id INT PRIMARY KEY);",
        "ALTER TABLE $probeName ADD COLUMN marker INT;",
        "DROP TABLE $probeName;"
    )

    foreach ($ddlSql in $ddlChecks) {
        $result = Invoke-MySqlRuntime -Sql $ddlSql
        if ($result.ExitCode -eq 0) {
            throw "Runtime user unexpectedly succeeded with DDL probe: $ddlSql"
        }
    }
}

Write-Output "[DB] Runtime grants validated for '$runtimeUser' on '$dbName'. No DDL/admin grants found."
