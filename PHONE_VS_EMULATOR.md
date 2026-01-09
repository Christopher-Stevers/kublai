# Physical Phone vs Android Emulator

## Both Options Work!

You can use either:
1. **Physical Phone** (via USB) - What we've been setting up
2. **Android Emulator** (on your computer) - Virtual device

## Option 1: Physical Phone (Current Setup)

### Advantages:
- ✅ Real device testing
- ✅ Better performance (usually)
- ✅ Test on actual hardware
- ✅ No need to download large emulator images

### Requirements:
- Phone connected via USB
- USB debugging enabled
- Same Wi-Fi network (for dev server connection)

### How to Use:
```powershell
# 1. Connect phone via USB
# 2. Enable USB debugging on phone
# 3. Build and install:
cd apps/mobile
.\build-android.ps1
```

The script will automatically detect your phone and install the app.

## Option 2: Android Emulator (Virtual Device)

### Advantages:
- ✅ No physical phone needed
- ✅ Can test different Android versions
- ✅ Can test different screen sizes
- ✅ Easier to take screenshots/recordings

### Requirements:
- Android Studio (or Android SDK)
- Emulator image downloaded
- More disk space (~2-4GB per emulator)

### How to Set Up Emulator:

**If Android Studio is working:**
1. Open Android Studio
2. Tools → Device Manager
3. Create Virtual Device
4. Choose a device (e.g., Pixel 5)
5. Download a system image (e.g., Android 13)
6. Finish setup

**If Android Studio is NOT working:**
You can use command line to create/manage emulators, but it's more complex.

### Using Emulator with Build Script:

The build script will work with emulators too! Just:
1. Start the emulator first (from Android Studio or command line)
2. Run the build script - it will detect the emulator as a "device"
3. App installs on emulator

```powershell
# Start emulator (if you have one set up)
# Then build:
cd apps/mobile
.\build-android.ps1
```

## Which Should You Use?

### Use Physical Phone If:
- ✅ You want to test on real hardware
- ✅ You don't want to download large emulator images
- ✅ You want better performance
- ✅ You're testing device-specific features (camera, GPS, etc.)

### Use Emulator If:
- ✅ You don't have a physical Android phone
- ✅ You want to test different Android versions
- ✅ You want to test different screen sizes
- ✅ You're doing UI/UX testing

## Current Setup

**What we've configured works for BOTH:**
- The build script detects any device (phone or emulator) via `adb devices`
- The Capacitor config works the same way
- The network setup (LAN IP) works for both

## Quick Test: Check What's Connected

```powershell
# Check what devices are available
adb devices
```

You'll see:
- Physical phones: `[device_id]    device`
- Emulators: `emulator-5554    device`
- Nothing: `List of devices attached` (empty)

## Recommendation

**For now, use your physical phone** because:
1. Android Studio is having issues (so emulator setup is harder)
2. Physical phone is simpler - just connect and go
3. Real device testing is more accurate
4. The build script is already set up for it

**Later, you can add an emulator** when Android Studio is fixed, if you want to test on different devices/versions.

## Troubleshooting

### Phone Not Detected:
```powershell
# Check connection
adb devices

# If empty:
# 1. Enable USB debugging on phone
# 2. Accept "Allow USB debugging?" prompt
# 3. Try different USB cable/port
# 4. Restart ADB:
adb kill-server
adb start-server
adb devices
```

### Emulator Not Starting:
- Make sure Android Studio/SDK is properly installed
- Check that you have enough RAM (emulators need 2-4GB)
- Try creating a new emulator with less RAM allocation

