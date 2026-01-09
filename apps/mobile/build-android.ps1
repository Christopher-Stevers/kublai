# Build and install Android app without Android Studio
# Usage: .\build-android.ps1 [IP_ADDRESS]

param(
    [string]$DevUrl = "http://192.168.1.15:3000"
)

Write-Host "=== Building Android App ===" -ForegroundColor Cyan
Write-Host ""

# Check if we're in the right directory
if (-not (Test-Path "android\gradlew.bat")) {
    Write-Host "Error: Must run from apps/mobile directory" -ForegroundColor Red
    Write-Host "Current directory: $(Get-Location)" -ForegroundColor Yellow
    exit 1
}

# Step 1: Sync Capacitor
Write-Host "Step 1: Syncing Capacitor..." -ForegroundColor Yellow
$env:CAP_DEV_URL = $DevUrl
$env:CAP_MODE = "dev"

try {
    npx cap sync 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ Capacitor synced successfully" -ForegroundColor Green
    } else {
        Write-Host "✗ Capacitor sync failed" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Error syncing Capacitor: $_" -ForegroundColor Red
    exit 1
}

Write-Host ""

# Step 2: Check phone connection
Write-Host "Step 2: Checking phone connection..." -ForegroundColor Yellow
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"

if (-not (Test-Path $adbPath)) {
    Write-Host "⚠ ADB not found. Trying to find it..." -ForegroundColor Yellow
    $adbPath = "adb"  # Try in PATH
}

try {
    $devices = & $adbPath devices 2>&1
    $deviceCount = ($devices | Select-String "device$" | Measure-Object).Count
    
    if ($deviceCount -eq 0) {
        Write-Host "⚠ No devices connected!" -ForegroundColor Yellow
        Write-Host "  Please:" -ForegroundColor Yellow
        Write-Host "  1. Connect your phone via USB" -ForegroundColor Yellow
        Write-Host "  2. Enable USB debugging" -ForegroundColor Yellow
        Write-Host "  3. Accept the 'Allow USB debugging?' prompt" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Continuing with build anyway (you can install manually later)..." -ForegroundColor Yellow
    } else {
        Write-Host "✓ Found $deviceCount device(s)" -ForegroundColor Green
        Write-Host $devices
    }
} catch {
    Write-Host "⚠ Could not check devices: $_" -ForegroundColor Yellow
    Write-Host "  Continuing with build anyway..." -ForegroundColor Yellow
}

Write-Host ""

# Step 3: Build and install
Write-Host "Step 3: Building and installing app..." -ForegroundColor Yellow
Write-Host "  (This may take a few minutes on first build)" -ForegroundColor Gray
Write-Host ""

# Set JAVA_HOME to use Android Studio's bundled Java (compatible with Gradle)
$androidStudioJava = "C:\Program Files\Android\Android Studio\jbr"
if (Test-Path $androidStudioJava) {
    $env:JAVA_HOME = $androidStudioJava
    Write-Host "Using Java from Android Studio" -ForegroundColor Gray
}

cd android

try {
    # Build and install
    .\gradlew installDebug
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host ""
        Write-Host "✓ Build and install successful!" -ForegroundColor Green
        Write-Host ""
        Write-Host "The app should now be on your phone." -ForegroundColor Cyan
        Write-Host "Open it and it will connect to: $DevUrl" -ForegroundColor Cyan
    } else {
        Write-Host ""
        Write-Host "✗ Build failed. Check errors above." -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "✗ Error building: $_" -ForegroundColor Red
    exit 1
} finally {
    cd ..
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan

