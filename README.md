# Create T3 App

This is a [T3 Stack](https://create.t3.gg/) project bootstrapped with `create-t3-app`.

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- pnpm (package manager)
- Docker Desktop for Windows (or Docker/Podman on Linux/macOS)

### Setup

1. **Install dependencies:**
   ```bash
   pnpm install
   ```

2. **Set up environment variables:**
   - Copy `.env.example` to `.env` (if it doesn't exist)
   - Update the `DATABASE_URL` in `.env` to match your database configuration
   - Add your Discord OAuth credentials for authentication

3. **Start the database:**
   
   **On Windows (PowerShell):**
   ```powershell
   .\start-database.ps1
   ```
   
   **On Windows (WSL/Linux) or macOS/Linux:**
   ```bash
   docker-compose up -d
   ```
   
   Or use the provided script:
   ```bash
   ./start-database.sh
   ```

4. **Run database migrations:**
   ```bash
   pnpm db:push
   ```

5. **Start the development server:**
   ```bash
   pnpm dev
   ```

The app will be available at [http://localhost:3000](http://localhost:3000).

**Note:** The dev server now runs on `0.0.0.0:3000` to allow mobile devices on your local network to access it.

### Database Management

- **Start database:** `docker-compose up -d`
- **Stop database:** `docker-compose down`
- **View logs:** `docker-compose logs -f postgres`
- **Open Drizzle Studio:** `pnpm db:studio`

## What's next? How do I make an app with this?

We try to keep this project as simple as possible, so you can start with just the scaffolding we set up for you, and add additional things later when they become necessary.

If you are not familiar with the different technologies used in this project, please refer to the respective docs. If you still are in the wind, please join our [Discord](https://t3.gg/discord) and ask for help.

- [Next.js](https://nextjs.org)

- [Prisma](https://prisma.io)
- [Drizzle](https://orm.drizzle.team)
- [Tailwind CSS](https://tailwindcss.com)
- [tRPC](https://trpc.io)

## Learn More

To learn more about the [T3 Stack](https://create.t3.gg/), take a look at the following resources:

- [Documentation](https://create.t3.gg/)
- [Learn the T3 Stack](https://create.t3.gg/en/faq#what-learning-resources-are-currently-available) — Check out these awesome tutorials

You can check out the [create-t3-app GitHub repository](https://github.com/t3-oss/create-t3-app) — your feedback and contributions are welcome!

## Mobile Development

This project includes a Capacitor mobile wrapper that loads the Next.js web app in a native shell.

### Prerequisites

- Node.js (v18 or higher)
- pnpm (package manager)
- Xcode (for iOS development, macOS only)
- Android Studio (for Android development)

### Mobile Setup

1. **Install mobile dependencies:**
   ```bash
   cd apps/mobile
   pnpm install
   ```

2. **Add native platforms:**
   ```bash
   npx cap add ios
   npx cap add android
   ```

### Running on a Real Device (Development)

1. **Start the Next.js dev server** (from project root):
   ```bash
   pnpm dev
   ```
   The server will be accessible on your LAN at `http://YOUR_LAN_IP:3000`

2. **Find your computer's LAN IP:**
   - **Windows:** Run `ipconfig` and look for IPv4 Address
   - **macOS/Linux:** Run `ifconfig` or `ip addr` and look for your network interface IP

3. **Sync Capacitor for development:**
   ```bash
   cd apps/mobile
   CAP_DEV_URL=http://YOUR_LAN_IP:3000 pnpm sync:dev
   ```

4. **Open in native IDE:**
   ```bash
   # For iOS
   pnpm ios
   
   # For Android
   pnpm android
   ```

5. **Run on device/simulator** from Xcode or Android Studio

### Production Builds

For production builds, sync with production mode:

```bash
cd apps/mobile
CAP_PROD_URL=https://app.yourdomain.com pnpm sync:prod
```

**Important:** Update `CAP_PROD_URL` to your actual production domain before building for production.

### Clerk Configuration for Mobile

Since the mobile app loads your web app from the same origin:
- Clerk sessions and cookies work automatically (no CORS issues)
- Add your production domain to Clerk's **Allowed Origins** in the Clerk dashboard
- For LAN dev mode: Use email/password authentication (OAuth may not work with IP addresses)

### Mobile App Structure

- `apps/mobile/` - Capacitor mobile app
- `apps/mobile/capacitor.config.ts` - Capacitor configuration
- `apps/mobile/www/` - Minimal placeholder (required by Capacitor, even in hosted mode)

The mobile app uses "hosted mode" which means:
- **Production:** Loads from your production URL (`https://app.yourdomain.com`)
- **Development:** Loads from your LAN IP (`http://192.168.x.x:3000`)

This approach means web updates ship instantly (no App Store review needed), and you only need to update the native app when adding native plugins or changing the shell.

## How do I deploy this?

Follow our deployment guides for [Vercel](https://create.t3.gg/en/deployment/vercel), [Netlify](https://create.t3.gg/en/deployment/netlify) and [Docker](https://create.t3.gg/en/deployment/docker) for more information.
