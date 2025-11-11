import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs-extra';
import dotenv from 'dotenv';

dotenv.config(); // Load .env variables

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getConfig() {
  const keyPath = path.resolve(__dirname, "service-account.json");

  if (!fs.existsSync(keyPath)) {
    throw new Error(`Missing service account key at ${keyPath}`);
  }

  // Load Drive IDs from .env
  const driveFolderId = process.env.DRIVE_FOLDER_ID || "fallback-folder-id-if-needed";
  const driveId = process.env.DRIVE_ID || null;

  console.log("🔍 Config loaded from .env:");
  console.log("   DRIVE_FOLDER_ID:", driveFolderId);
  console.log("   DRIVE_ID:", driveId);

  const config = {
    keyFile: keyPath,
    scopes: ["https://www.googleapis.com/auth/drive"],
    driveFolderId,
    driveId,
  };

  return config;
}