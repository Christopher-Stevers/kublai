# Fixing Android Studio Startup Error

## The Problem
Android Studio is showing: `java.lang.ClassNotFoundException: com.intellij.platform.core.nio.fs.MultiRoutingFileSystemProvider`

This indicates a corrupted or incompatible Android Studio installation.

## Solution 1: Clear Android Studio Caches (Try This First)

**Windows:**
```powershell
# Close Android Studio completely first!

# Clear caches
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\caches"
Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*\system\caches"

# Clear config (more aggressive - you'll need to reconfigure Android Studio)
# Remove-Item -Recurse -Force "$env:APPDATA\Google\AndroidStudio*"
```

Then try opening Android Studio again.

## Solution 2: Reinstall Android Studio

1. **Uninstall Android Studio:**
   - Settings → Apps → Android Studio → Uninstall
   - Or use the uninstaller from Control Panel

2. **Delete leftover folders:**
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Google\AndroidStudio*"
   Remove-Item -Recurse -Force "$env:APPDATA\Google\AndroidStudio*"
   ```

3. **Download and reinstall:**
   - Get latest from: https://developer.android.com/studio
   - Install fresh

## Solution 3: Build and Run WITHOUT Android Studio (Recommended for Now)

You can build and install the app directly using Gradle command line:

### Prerequisites
- Android SDK installed (usually comes with Android Studio)
- ADB in your PATH (Android Debug Bridge)

### Steps

1. **Find your LAN IP:**
   ```powershell
   ipconfig
   ```
   Note your Wi-Fi IPv4 address (e.g., `192.168.1.15`)

2. **Start Next.js dev server** (in one terminal):
   ```powershell
   cd D:\Chris\Startups\kublai
   pnpm dev
   ```

3. **Sync Capacitor** (in another terminal):
   ```powershell
   cd D:\Chris\Startups\kublai\apps\mobile
   $env:CAP_DEV_URL="http://192.168.1.15:3000"
   $env:CAP_MODE="dev"
   pnpm sync:dev
   ```

4. **Connect your phone:**
   ```powershell
   # Check if phone is connected
   adb devices
   
   # If not showing, enable USB debugging on phone and try again
   ```

5. **Build and install directly:**
   ```powershell
   cd D:\Chris\Startups\kublai\apps\mobile\android
   
   # Build debug APK
   .\gradlew assembleDebug
   
   # Install on connected device
   .\gradlew installDebug
   ```

6. **Or build and install in one command:**
   ```powershell
   cd D:\Chris\Startups\kublai\apps\mobile\android
   .\gradlew installDebug
   ```

The app will be installed on your phone automatically!

### Running the App
- The app should appear on your phone
- Open it from the app drawer
- It will connect to your Next.js dev server

### Rebuild After Changes
If you change native code or Capacitor config:
```powershell
cd D:\Chris\Startups\kublai\apps\mobile
$env:CAP_DEV_URL="http://192.168.1.15:3000"
$env:CAP_MODE="dev"
pnpm sync:dev
cd android
.\gradlew installDebug
```

## Solution 4: Use Android Studio Canary/Preview

Sometimes the stable version has issues. Try:
- Android Studio Preview: https://developer.android.com/studio/preview
- Or an older stable version

## Quick Reference: Build Without Android Studio

```powershell
# 1. Sync Capacitor
cd D:\Chris\Startups\kublai\apps\mobile
$env:CAP_DEV_URL="http://YOUR_IP:3000"
$env:CAP_MODE="dev"
pnpm sync:dev

# 2. Build and install
cd android
.\gradlew installDebug

# 3. Check logs (optional)
adb logcat | Select-String "ForemanHQ"
```

## Finding ADB

If `adb` command not found:
- Usually at: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`
- Add to PATH or use full path:
  ```powershell
  & "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" devices
  ```

