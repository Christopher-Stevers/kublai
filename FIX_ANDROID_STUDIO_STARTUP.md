# Fix Android Studio Startup Error

## The Error
`java.lang.ClassNotFoundException: com.intellij.platform.core.nio.fs.MultiRoutingFileSystemProvider`

This is an Android Studio installation corruption issue.

## Solution 1: Clear Android Studio Caches (Try This First)

**Close Android Studio completely first!**

```powershell
# Clear all Android Studio caches
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\caches" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\system\caches" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\system\jdk.table.xml" -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\system\jdk.table.xml.lock" -ErrorAction SilentlyContinue

# Clear logs
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\log" -ErrorAction SilentlyContinue

Write-Host "Caches cleared. Try opening Android Studio again."
```

Then try opening Android Studio manually (not through the script).

## Solution 2: Reinstall Android Studio

If clearing caches doesn't work:

1. **Uninstall Android Studio:**
   - Settings → Apps → Android Studio → Uninstall

2. **Delete all leftover files:**
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*" -ErrorAction SilentlyContinue
   Remove-Item -Recurse -Force "$env:APPDATA\Google\AndroidStudio*" -ErrorAction SilentlyContinue
   Remove-Item -Recurse -Force "$env:USERPROFILE\.android" -ErrorAction SilentlyContinue
   Remove-Item -Recurse -Force "$env:USERPROFILE\.gradle" -ErrorAction SilentlyContinue
   ```

3. **Download and reinstall:**
   - https://developer.android.com/studio
   - Install fresh

## Solution 3: Build WITHOUT Android Studio (Recommended for Now)

You can build and install the app directly using Gradle - no Android Studio needed!

### Prerequisites Check

```powershell
# Check if Java is installed
java -version

# Check if ADB is available (for installing to phone)
adb version
```

If ADB not found, it's usually at:
```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" version
```

### Build and Install Steps

1. **Start Next.js dev server** (Terminal 1):
   ```powershell
   cd D:\Chris\Startups\kublai
   pnpm dev
   ```

2. **Sync Capacitor** (Terminal 2):
   ```powershell
   cd D:\Chris\Startups\kublai\apps\mobile
   $env:CAP_DEV_URL="http://192.168.1.15:3000"  # Use YOUR IP
   $env:CAP_MODE="dev"
   pnpm sync:dev
   ```

3. **Connect your phone:**
   ```powershell
   # Check if phone is connected
   adb devices
   
   # If not showing:
   # - Enable USB debugging on phone
   # - Accept the "Allow USB debugging?" prompt
   # - Try different USB cable/port
   ```

4. **Build and install directly:**
   ```powershell
   cd D:\Chris\Startups\kublai\apps\mobile\android
   
   # Build and install in one command
   .\gradlew installDebug
   ```

   This will:
   - Build the debug APK
   - Install it on your connected phone
   - The app will appear on your phone!

5. **Run the app:**
   - Open the app on your phone
   - It should connect to your Next.js dev server

### Rebuild After Changes

If you change native code or Capacitor config:
```powershell
# 1. Sync
cd D:\Chris\Startups\kublai\apps\mobile
$env:CAP_DEV_URL="http://192.168.1.15:3000"
$env:CAP_MODE="dev"
pnpm sync:dev

# 2. Rebuild and install
cd android
.\gradlew installDebug
```

## Solution 4: Use Android Studio Preview/Canary

Sometimes the stable version has bugs. Try:
- Android Studio Preview: https://developer.android.com/studio/preview
- Or download an older stable version

## Quick Reference: Build Without Android Studio

```powershell
# Full workflow
cd D:\Chris\Startups\kublai\apps\mobile

# Sync
$env:CAP_DEV_URL="http://YOUR_IP:3000"
$env:CAP_MODE="dev"
pnpm sync:dev

# Build and install
cd android
.\gradlew installDebug

# Check logs (optional)
adb logcat | Select-String "ForemanHQ"
```

## Finding Your Tools

**ADB location:**
```powershell
$adbPath = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"
if (Test-Path $adbPath) {
    Write-Host "ADB found at: $adbPath"
    & $adbPath devices
} else {
    Write-Host "ADB not found. Install Android SDK Platform Tools."
}
```

**Java location:**
```powershell
# Usually comes with Android Studio
$javaPath = "$env:JAVA_HOME\bin\java.exe"
# Or check: $env:LOCALAPPDATA\Programs\Android\Android Studio\jbr\bin\java.exe
```



