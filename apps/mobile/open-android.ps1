# Script to open Android Studio with the project manually
# This avoids the error when using 'npx cap open android'

$projectPath = Join-Path $PSScriptRoot "android"

# Try to find Android Studio in common locations
$studioPaths = @(
    "$env:LOCALAPPDATA\Programs\Android\Android Studio\bin\studio64.exe",
    "$env:ProgramFiles\Android\Android Studio\bin\studio64.exe",
    "${env:ProgramFiles(x86)}\Android\Android Studio\bin\studio64.exe"
)

$studioExe = $null
foreach ($path in $studioPaths) {
    if (Test-Path $path) {
        $studioExe = $path
        break
    }
}

if ($studioExe) {
    Write-Host "Found Android Studio at: $studioExe"
    Write-Host "Opening project: $projectPath"
    Write-Host ""
    Write-Host "If Android Studio shows an error, try:"
    Write-Host "  1. Close Android Studio"
    Write-Host "  2. Open Android Studio manually"
    Write-Host "  3. File → Open → $projectPath"
    Write-Host ""
    
    # Open with the project path
    Start-Process -FilePath $studioExe -ArgumentList "`"$projectPath`""
} else {
    Write-Host "Android Studio not found in standard locations."
    Write-Host ""
    Write-Host "Please open Android Studio manually:"
    Write-Host "  1. Open Android Studio"
    Write-Host "  2. File → Open"
    Write-Host "  3. Navigate to: $projectPath"
    Write-Host ""
    Write-Host "Or find studio64.exe and run:"
    Write-Host "  studio64.exe `"$projectPath`""
}



