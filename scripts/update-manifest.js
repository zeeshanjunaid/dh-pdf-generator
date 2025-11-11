import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");

const MANIFEST_PATH = path.resolve(ROOT_DIR, "data", "manifest.json");

export async function updateManifest(filename) {
  const now = new Date().toISOString();
  const manifest = (await fs.pathExists(MANIFEST_PATH))
    ? JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"))
    : {};

  manifest[filename] = now;

  await fs.outputJson(MANIFEST_PATH, manifest, { spaces: 2 });
  console.log(`📝 Updated manifest for ${filename}`);
}

export async function getManifest() {
  return (await fs.pathExists(MANIFEST_PATH))
    ? JSON.parse(await fs.readFile(MANIFEST_PATH, "utf8"))
    : {};
}