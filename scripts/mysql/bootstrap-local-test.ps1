param(
    [string]$Mysql = 'mysql',
    [string]$LoginPath = '',
    [string]$AdminUser = $env:TSPCC_DB_ADMIN_USER,
    [string]$AdminPassword = $env:TSPCC_DB_ADMIN_PASSWORD,
    [string]$AdminHost = '',
    [int]$AdminPort = 0,
    [switch]$PrintSql
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
        throw "$Name is required. Set it in shell environment or a local .env file outside Git."
    }
    if ($value -match '^<.*>$') {
        throw "$Name still contains a placeholder value."
    }

    return $value
}

function Quote-MySqlIdentifier {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) {
        throw 'MySQL identifier cannot be empty.'
    }
    return '`' + ($Value -replace '`', '``') + '`'
}

function Quote-MySqlString {
    param([string]$Value)
    if ($null -eq $Value) {
        throw 'MySQL string cannot be null.'
    }
    return "'" + ($Value -replace "'", "''") + "'"
}

function New-MySqlAccount {
    param(
        [string]$User,
        [string]$AccountHost
    )

    return "$(Quote-MySqlString $User)@$(Quote-MySqlString $AccountHost)"
}

$dbHost = Get-EnvOrDefault -Name 'TSPCC_DB_HOST' -DefaultValue '127.0.0.1'
$dbPortText = Get-EnvOrDefault -Name 'TSPCC_DB_PORT' -DefaultValue '3306'
$dbName = Get-EnvOrDefault -Name 'TSPCC_DB_NAME' -DefaultValue 'tspcc_bd'
$runtimeUser = Get-EnvOrDefault -Name 'TSPCC_DB_USER' -DefaultValue 'tspcc_app'
$runtimePassword = Get-RequiredEnv -Name 'TSPCC_DB_PASSWORD'
$connectionLimit = Get-EnvOrDefault -Name 'TSPCC_DB_CONNECTION_LIMIT' -DefaultValue '10'
$dbSsl = Get-EnvOrDefault -Name 'TSPCC_DB_SSL' -DefaultValue 'disabled'
$migrationUser = Get-RequiredEnv -Name 'TSPCC_DB_MIGRATION_USER'
$migrationPassword = Get-RequiredEnv -Name 'TSPCC_DB_MIGRATION_PASSWORD'

[int]$dbPort = 0
if (-not [int]::TryParse($dbPortText, [ref]$dbPort) -or $dbPort -le 0) {
    throw "TSPCC_DB_PORT must be a positive integer. Current value: $dbPortText"
}

[int]$limit = 0
if (-not [int]::TryParse($connectionLimit, [ref]$limit) -or $limit -le 0) {
    throw "TSPCC_DB_CONNECTION_LIMIT must be a positive integer. Current value: $connectionLimit"
}

if (@('disabled', 'required', 'custom') -notcontains $dbSsl) {
    throw 'TSPCC_DB_SSL must be one of: disabled, required, custom.'
}

if ($runtimeUser -ne 'tspcc_app') {
    throw "TSPCC_DB_USER must be tspcc_app for the Stage 1 contract. Current value: $runtimeUser"
}

if ($migrationUser -eq $runtimeUser) {
    throw 'TSPCC_DB_MIGRATION_USER must be separate from TSPCC_DB_USER.'
}

if ($migrationPassword -eq $runtimePassword) {
    throw 'TSPCC_DB_MIGRATION_PASSWORD must differ from TSPCC_DB_PASSWORD.'
}

if ([string]::IsNullOrWhiteSpace($AdminHost)) {
    $AdminHost = Get-EnvOrDefault -Name 'TSPCC_DB_ADMIN_HOST' -DefaultValue $dbHost
}
if ($AdminPort -le 0) {
    $AdminPort = $dbPort
}

$accountHost = $dbHost
$dbIdentifier = Quote-MySqlIdentifier $dbName
$runtimeAccount = New-MySqlAccount -User $runtimeUser -AccountHost $accountHost
$migrationAccount = New-MySqlAccount -User $migrationUser -AccountHost $accountHost

$sql = @"
CREATE DATABASE IF NOT EXISTS $dbIdentifier CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

CREATE USER IF NOT EXISTS $runtimeAccount IDENTIFIED BY $(Quote-MySqlString $runtimePassword);
ALTER USER $runtimeAccount IDENTIFIED BY $(Quote-MySqlString $runtimePassword);
REVOKE ALL PRIVILEGES, GRANT OPTION FROM $runtimeAccount;
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE ON $dbIdentifier.* TO $runtimeAccount;

CREATE USER IF NOT EXISTS $migrationAccount IDENTIFIED BY $(Quote-MySqlString $migrationPassword);
ALTER USER $migrationAccount IDENTIFIED BY $(Quote-MySqlString $migrationPassword);
REVOKE ALL PRIVILEGES, GRANT OPTION FROM $migrationAccount;
GRANT SELECT, INSERT, UPDATE, DELETE, EXECUTE, CREATE, ALTER, DROP, INDEX, REFERENCES, CREATE VIEW, SHOW VIEW ON $dbIdentifier.* TO $migrationAccount;

FLUSH PRIVILEGES;
"@

if ($PrintSql) {
    $redacted = $sql `
        -replace [regex]::Escape((Quote-MySqlString $runtimePassword)), "'<runtime secret>'" `
        -replace [regex]::Escape((Quote-MySqlString $migrationPassword)), "'<migration secret>'"
    Write-Output $redacted
    exit 0
}

$mysqlArgs = @()
if (-not [string]::IsNullOrWhiteSpace($LoginPath)) {
    $mysqlArgs += "--login-path=$LoginPath"
}
else {
    if ([string]::IsNullOrWhiteSpace($AdminUser)) {
        throw 'Provide -LoginPath or -AdminUser/TSPCC_DB_ADMIN_USER for MySQL bootstrap.'
    }
    $mysqlArgs += "--host=$AdminHost"
    $mysqlArgs += "--port=$AdminPort"
    $mysqlArgs += "--user=$AdminUser"
}

$previousMysqlPwd = [Environment]::GetEnvironmentVariable('MYSQL_PWD')
try {
    if ([string]::IsNullOrWhiteSpace($LoginPath) -and -not [string]::IsNullOrEmpty($AdminPassword)) {
        $env:MYSQL_PWD = $AdminPassword
    }

    $sql | & $Mysql @mysqlArgs
    if ($LASTEXITCODE -ne 0) {
        throw "mysql bootstrap failed with exit code $LASTEXITCODE."
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

Write-Output "[DB] MySQL local/test bootstrap completed for database '$dbName'. Runtime user has no DDL grants."
