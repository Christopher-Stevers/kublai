# PowerShell script to start the database using docker-compose
# Run this script from PowerShell: .\start-database.ps1

Write-Host "Starting PostgreSQL database with docker-compose..." -ForegroundColor Green

# Load .env file if it exists to extract database config
if (Test-Path .env) {
    $envContent = Get-Content .env | Where-Object { $_ -match '^[^#]' -and $_ -match '=' }
    foreach ($line in $envContent) {
        if ($line -match '^DATABASE_URL=(.+)') {
            $dbUrl = $matches[1].Trim('"').Trim("'")
            # Parse DATABASE_URL: postgresql://postgres:password@localhost:5432/kublai
            if ($dbUrl -match 'postgresql://[^:]+:([^@]+)@[^:]+:(\d+)/(.+)') {
                $env:POSTGRES_PASSWORD = $matches[1]
                $env:POSTGRES_PORT = $matches[2]
                $env:POSTGRES_DB = $matches[3]
                Write-Host "Loaded database configuration from .env" -ForegroundColor Cyan
            }
        }
    }
}

# Check if docker-compose is available
if (-not (Get-Command docker-compose -ErrorAction SilentlyContinue) -and -not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker is not installed or not in PATH. Please install Docker Desktop for Windows." -ForegroundColor Red
    Write-Host "Download from: https://docs.docker.com/docker-for-windows/install/" -ForegroundColor Yellow
    exit 1
}

# Check if Docker daemon is running
try {
    docker info | Out-Null
} catch {
    Write-Host "Docker daemon is not running. Please start Docker Desktop and try again." -ForegroundColor Red
    exit 1
}

# Determine docker command
$dockerCmd = "docker"
if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
    $composeCmd = "docker-compose"
} else {
    $composeCmd = "docker compose"
}

# Start the database
Write-Host "Starting database container..." -ForegroundColor Cyan
& $dockerCmd $composeCmd.Split(' ') up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host "Database started successfully!" -ForegroundColor Green
    Write-Host "You can check the status with: $composeCmd ps" -ForegroundColor Cyan
    Write-Host "You can view logs with: $composeCmd logs -f postgres" -ForegroundColor Cyan
    Write-Host "You can stop the database with: $composeCmd down" -ForegroundColor Cyan
} else {
    Write-Host "Failed to start database. Please check the error messages above." -ForegroundColor Red
    exit 1
}

