const { config: dotenvConfig } = require("dotenv");
const { resolve } = require("path");

// Load environment variables from root .env file
// __dirname is available in CommonJS context (when loaded by Capacitor CLI)
const envPath = resolve(__dirname, "../../.env");
dotenvConfig({ path: envPath });

const PROD_URL = process.env.CAP_PROD_URL || "https://app.yourdomain.com";
const DEV_URL = process.env.CAP_DEV_URL || "http://192.168.1.10:3000";
const MODE = process.env.CAP_MODE || "prod";

const config = {
  appId: "com.foremanhq.app",
  appName: "ForemanHQ",
  webDir: "www",
  server: {
    url: MODE === "dev" ? DEV_URL : PROD_URL,
    cleartext: MODE === "dev", // allow http only for dev
  },
};

module.exports = config;

