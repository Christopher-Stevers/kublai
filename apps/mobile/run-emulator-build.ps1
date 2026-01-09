# Complete workflow: Start emulator and build app
# Usage: .\run-emulator-build.ps1 [IP_ADDRESS]

param(
    [string]$DevUrl = "http://192.168.1.15:3000",
    [string]$AvdName = "Medium_Phone_API_36.0"
)

Write-Host "=== Android Emulator Build Workflow ===" -ForegroundColor Cyan
Write-Host ""

# Step 1: Check if emulator is running
Write-Host "Step 1: Checking emulator status..." -ForegroundColor Yellow
$devices = adb devices 2>&1
$emulatorRunning = $devices -match "emulator"

if (-not $emulatorRunning) {
    Write-Host "⚠ Emulator not detected. Starting emulator..." -ForegroundColor Yellow
    Write-Host ""
    
    $emulatorPath = "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe"
    if (Test-Path $emulatorPath) {
        Write-Host "Starting: $AvdName" -ForegroundColor Cyan
        Start-Process -FilePath $emulatorPath -ArgumentList "-avd", $AvdName
        
        Write-Host ""
        Write-Host "Waiting for emulator to boot (this takes 30-60 seconds)..." -ForegroundColor Yellow
        Write-Host "Please wait for the Android home screen to appear." -ForegroundColor Yellow
        Write-Host ""
        
        # Wait and check
        $maxWait = 60
        $waited = 0
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 5
            $waited += 5
            $checkDevices = adb devices 2>&1
            if ($checkDevices -match "emulator.*device") {
                Write-Host "✓ Emulator is ready!" -ForegroundColor Green
                break
            }
            Write-Host "  Still waiting... ($waited/$maxWait seconds)" -ForegroundColor Gray
        }
        
        $finalCheck = adb devices 2>&1
        if (-not ($finalCheck -match "emulator.*device")) {
            Write-Host ""
            Write-Host "⚠ Emulator may still be booting. Please wait for the home screen," -ForegroundColor Yellow
            Write-Host "  then run: .\build-android.ps1 -DevUrl $DevUrl" -ForegroundColor White
            exit 1
        }
    } else {
        Write-Host "✗ Emulator not found. Please start it manually or use a physical phone." -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "✓ Emulator is already running" -ForegroundColor Green
    Write-Host $devices
}

Write-Host ""

# Step 2: Build and install
Write-Host "Step 2: Building and installing app..." -ForegroundColor Yellow
Write-Host ""

# Call the build script
& ".\build-android.ps1" -DevUrl $DevUrl

