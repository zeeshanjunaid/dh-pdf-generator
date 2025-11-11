import fs from "fs";
import path from "path";
import chalk from "chalk";
import { fileURLToPath } from "url";
import { validateJsonSchema } from "./validate-json.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(ROOT_DIR, "data");

async function main() {
  console.log(chalk.cyan("🧾 Validating all JSON files...\n"));

  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
  if (!files.length) {
    console.log(chalk.yellow("⚠️  No JSON files found in /data directory."));
    process.exit(0);
  }

  let validCount = 0;
  let invalidCount = 0;

  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    let jsonData;

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      jsonData = JSON.parse(content);
    } catch (err) {
      console.error(chalk.red(`❌ ${file} – Invalid JSON syntax (${err.message})`));
      invalidCount++;
      continue;
    }

    const isValid = validateJsonSchema(jsonData, file);
    if (isValid) validCount++;
    else invalidCount++;

    console.log(); // spacing between files
  }

  const total = validCount + invalidCount;
  console.log(chalk.gray("───────────────"));
  console.log(
    `${chalk.green(`✅ ${validCount} valid`)} | ${chalk.red(`❌ ${invalidCount} invalid`)} | ${chalk.cyan(`${total} total`)}`
  );
}

main().catch(err => {
  console.error(chalk.red("Unexpected error:"), err);
});