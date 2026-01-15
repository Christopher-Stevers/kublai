# Setup and run Android Emulator
# This script helps set up and start an Android emulator without Android Studio

$sdkPath = "$env:LOCALAPPDATA\Android\Sdk"
$emulatorPath = "$sdkPath\emulator\emulator.exe"
$avdManagerPath = $null

# Find AVD Manager (command-line tools)
$cmdlineTools = Get-ChildItem "$sdkPath\cmdline-tools" -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending | Select-Object -First 1
if ($cmdlineTools) {
    $avdManagerPath = Join-Path $cmdlineTools.FullName "bin\avdmanager.bat"
    if (-not (Test-Path $avdManagerPath)) {
        $avdManagerPath = Join-Path $cmdlineTools.FullName "bin\sdkmanager.bat"
    }
}

Write-Host "=== Android Emulator Setup ===" -ForegroundColor Cyan
Write-Host ""

# Check if emulator exists
if (-not (Test-Path $emulatorPath)) {
    Write-Host "✗ Android Emulator not found!" -ForegroundColor Red
    Write-Host "  Expected at: $emulatorPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You need to install Android SDK Platform Tools and Emulator." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Options:" -ForegroundColor Yellow
    Write-Host "1. Install via Android Studio (if it's working)" -ForegroundColor White
    Write-Host "2. Download Android SDK Command Line Tools:" -ForegroundColor White
    Write-Host "   https://developer.android.com/studio#command-tools" -ForegroundColor Cyan
    Write-Host "3. Use a physical phone instead (simpler)" -ForegroundColor White
    Write-Host ""
    exit 1
}

Write-Host "✓ Emulator found at: $emulatorPath" -ForegroundColor Green
Write-Host ""

# List available AVDs (Android Virtual Devices)
Write-Host "Checking for existing emulators..." -ForegroundColor Yellow
$avdPath = "$env:USERPROFILE\.android\avd"

if (Test-Path $avdPath) {
    $avds = Get-ChildItem $avdPath -Filter "*.avd" -Directory
    if ($avds.Count -gt 0) {
        Write-Host "✓ Found $($avds.Count) emulator(s):" -ForegroundColor Green
        foreach ($avd in $avds) {
            $name = $avd.Name -replace '\.avd$', ''
            Write-Host "  - $name" -ForegroundColor White
        }
        Write-Host ""
        
        # Ask which to start
        if ($avds.Count -eq 1) {
            $avdName = $avds[0].Name -replace '\.avd$', ''
            Write-Host "Starting: $avdName" -ForegroundColor Cyan
            Write-Host ""
            & $emulatorPath -avd $avdName
        } else {
            Write-Host "Multiple emulators found. Please specify which to start:" -ForegroundColor Yellow
            Write-Host "  .\setup-emulator.ps1 -AvdName <name>" -ForegroundColor White
            Write-Host ""
            Write-Host "Or start manually:" -ForegroundColor Yellow
            foreach ($avd in $avds) {
                $name = $avd.Name -replace '\.avd$', ''
                Write-Host "  & `"$emulatorPath`" -avd $name" -ForegroundColor White
            }
        }
    } else {
        Write-Host "⚠ No emulators found. You need to create one first." -ForegroundColor Yellow
        Write-Host ""
        Write-Host "To create an emulator, you need Android Studio working, OR:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "1. Install system images:" -ForegroundColor White
        Write-Host "   & `"$avdManagerPath`" `"system-images;android-33;google_apis;x86_64`"" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "2. Create AVD:" -ForegroundColor White
        Write-Host "   & `"$avdManagerPath`" create avd -n Pixel5 -k `"system-images;android-33;google_apis;x86_64`"" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "This is complex. Consider using a physical phone instead!" -ForegroundColor Yellow
    }
} else {
    Write-Host "⚠ No AVD directory found. No emulators created yet." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "You need to create an emulator first. This requires:" -ForegroundColor Yellow
    Write-Host "1. Android Studio (currently having issues)" -ForegroundColor White
    Write-Host "2. OR command-line tools (complex setup)" -ForegroundColor White
    Write-Host ""
    Write-Host "Recommendation: Use a physical phone for now!" -ForegroundColor Cyan
}



