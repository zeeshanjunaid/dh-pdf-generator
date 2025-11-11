import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";
import open from "open";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Point output to /templates instead of /output
const dataPath = path.join(__dirname, "../data", "2025.11.06-rpt-a.json");
const templatePath = path.join(__dirname, "../templates", "report.hbs");
const outputFile = path.join(__dirname, "../templates", "preview.html");

// Register Handlebars helpers
Handlebars.registerHelper("eq", (a, b) => a === b);

async function generatePreview() {
  try {
    const data = JSON.parse(await fs.readFile(dataPath, "utf8"));
    const templateSrc = await fs.readFile(templatePath, "utf8");
    const template = Handlebars.compile(templateSrc);

    const html = template(data);
    await fs.writeFile(outputFile, html, "utf8");

    console.log(`✅ Preview file generated: ${outputFile}`);
    await open(outputFile);
  } catch (err) {
    console.error("❌ Error generating preview:", err.message);
  }
}

generatePreview();