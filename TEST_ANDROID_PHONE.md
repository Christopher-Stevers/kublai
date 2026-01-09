# Testing Android App on Physical Phone

## Prerequisites
- Android Studio installed
- Android phone with USB debugging enabled
- Phone and computer on the same Wi-Fi network

## Step 1: Find Your Computer's LAN IP Address

**Windows:**
```powershell
ipconfig
```
Look for "IPv4 Address" under your Wi-Fi adapter (e.g., `192.168.1.15`)

**macOS/Linux:**
```bash
ifconfig | grep "inet " | grep -v 127.0.0.1
# or
ip addr show | grep "inet "
```

## Step 2: Enable USB Debugging on Your Phone

1. Go to **Settings** → **About phone**
2. Tap **Build number** 7 times to enable Developer options
3. Go back to **Settings** → **Developer options**
4. Enable **USB debugging**
5. Connect your phone to your computer via USB

## Step 3: Verify Phone Connection

```bash
# Check if your phone is detected
adb devices
```

You should see your device listed. If not:
- Make sure USB debugging is enabled
- Accept the "Allow USB debugging?" prompt on your phone
- Try a different USB cable/port

## Step 4: Start Next.js Development Server

**From project root:**
```bash
pnpm dev
```

The server should start on `http://0.0.0.0:3000` (accessible on your LAN)

**Important:** Keep this terminal running!

## Step 5: Configure Capacitor for Development

**From project root:**
```bash
cd apps/mobile
```

**Set your LAN IP and sync:**
```bash
# Replace 192.168.1.15 with YOUR actual LAN IP from Step 1
CAP_DEV_URL=http://192.168.1.15:3000 CAP_MODE=dev pnpm sync:dev
```

This updates the Capacitor config to point to your dev server.

## Step 6: Open Android Studio

```bash
pnpm android
```

This opens Android Studio with your project.

## Step 7: Build and Run on Your Phone

**In Android Studio:**

1. **Select your device:**
   - Look at the top toolbar for the device selector
   - Your physical phone should appear in the dropdown
   - If it doesn't, make sure `adb devices` shows it

2. **Build and Run:**
   - Click the green **Run** button (▶️) or press `Shift+F10`
   - Or go to **Run** → **Run 'app'**

3. **First build takes time:**
   - Android Studio will download dependencies if needed
   - Gradle will build the app (first time: 5-10 minutes)
   - The app will install on your phone

## Step 8: Verify Connection

Once the app opens on your phone:

1. **Check the app loads:** You should see your Next.js frontend
2. **Check API calls work:** Try logging in or using features that call `/api/trpc`
3. **Check network:** Make sure your phone is on the same Wi-Fi network

## Troubleshooting

### App shows blank screen or connection error

1. **Verify Next.js server is running:**
   ```bash
   # Should see: "Ready on http://0.0.0.0:3000"
   ```

2. **Check LAN IP is correct:**
   ```bash
   # Run ipconfig again - IP might have changed
   ipconfig
   ```

3. **Re-sync Capacitor with correct IP:**
   ```bash
   cd apps/mobile
   CAP_DEV_URL=http://YOUR_NEW_IP:3000 CAP_MODE=dev pnpm sync:dev
   ```

4. **Rebuild in Android Studio:**
   - Click **Build** → **Rebuild Project**
   - Then **Run** again

### "Network request failed" or API calls don't work

1. **Check phone and computer are on same Wi-Fi**
2. **Test from phone browser:** Open `http://YOUR_IP:3000` in Chrome on your phone
3. **Check firewall:** Windows Firewall might be blocking port 3000
   - Allow Node.js through firewall if prompted

### Phone not detected by Android Studio

1. **Check USB debugging:**
   ```bash
   adb devices
   ```

2. **Restart ADB:**
   ```bash
   adb kill-server
   adb start-server
   adb devices
   ```

3. **Try different USB cable/port**
4. **Install USB drivers** (if needed, Android Studio will prompt)

### App crashes on launch

1. **Check Android Studio Logcat:**
   - View → Tool Windows → Logcat
   - Look for red error messages

2. **Clear app data:**
   - Settings → Apps → ForemanHQ → Storage → Clear Data
   - Uninstall and reinstall

## Quick Reference Commands

```bash
# Find LAN IP (Windows)
ipconfig

# Check phone connection
adb devices

# Start dev server (from project root)
pnpm dev

# Sync Capacitor (from apps/mobile)
CAP_DEV_URL=http://192.168.1.15:3000 CAP_MODE=dev pnpm sync:dev

# Open Android Studio
cd apps/mobile && pnpm android
```

## Development Workflow

1. **Make code changes** in your Next.js app
2. **Hot reload** should work automatically (no need to rebuild Android app)
3. **If you change Capacitor config or native code:**
   - Run `pnpm sync:dev` again
   - Rebuild in Android Studio

## Production Build

When ready for production:
```bash
cd apps/mobile
CAP_PROD_URL=https://yourdomain.com CAP_MODE=prod pnpm sync:prod
```

Then build release APK in Android Studio.

