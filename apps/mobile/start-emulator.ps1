# Start Android Emulator
param(
    [string]$AvdName = "Medium_Phone_API_36.0"
)

$emulatorPath = "$env:LOCALAPPDATA\Android\Sdk\emulator\emulator.exe"

if (-not (Test-Path $emulatorPath)) {
    Write-Host "✗ Emulator not found at: $emulatorPath" -ForegroundColor Red
    exit 1
}

Write-Host "=== Starting Android Emulator ===" -ForegroundColor Cyan
Write-Host "Emulator: $AvdName" -ForegroundColor Yellow
Write-Host ""
Write-Host "Starting emulator (this may take a minute)..." -ForegroundColor Yellow
Write-Host "The emulator window will open - wait for it to fully boot." -ForegroundColor Yellow
Write-Host ""

# Start emulator in background
Start-Process -FilePath $emulatorPath -ArgumentList "-avd", $AvdName

Write-Host "Emulator is starting..." -ForegroundColor Green
Write-Host ""
Write-Host "Wait for the emulator to fully boot (you'll see the Android home screen)." -ForegroundColor Cyan
Write-Host "Then you can run: .\build-android.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "To check if it's ready:" -ForegroundColor Yellow
Write-Host "  adb devices" -ForegroundColor White

