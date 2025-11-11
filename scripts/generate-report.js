import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import Handlebars from "handlebars";
import { exec } from "child_process";

console.log("🧩 generate-report.js loaded from:", import.meta.url);

// Register a simple equality helper for section filtering
Handlebars.registerHelper("eq", (a, b) => a === b);

// ============================
// 🔧 Helper Function: Generate PDF
// ============================
export async function generatePDF(jsonPath) {
  try {
    // 1️⃣ Load JSON data
    const rawData = fs.readFileSync(jsonPath, "utf8");
    const data = JSON.parse(rawData);

    // 2️⃣ Load and compile Handlebars template
    const templatePath = path.join(process.cwd(), "templates", "report.hbs");
    const source = fs.readFileSync(templatePath, "utf8");
    const template = Handlebars.compile(source);

    // Make CSS path absolute so Puppeteer can render styles
    const cssPath = path.join(process.cwd(), "templates", "styles.css");
    const cssLink = `<link rel="stylesheet" href="file://${cssPath}" />`;
    const html = template(data).replace(
      '<link rel="stylesheet" href="../templates/styles.css" />',
      cssLink
    );

    // 3️⃣ Create timestamp and file name
    // 🧾 Derive patient-based filename (e.g., Jane-Doe-Nov-6-2025-0432-PM.pdf)
    const patientName =
      data?.report?.sections?.find((s) => s.id === "records_overview")?.fields
        ?.patient_name || "Unknown Patient";
    const [firstName, lastName] = patientName.trim().split(" ");

    const now = new Date();
    const formatted = now
      .toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(/,|:/g, "")
      .replace(/\s+/g, "-");  

    const fileName = `${firstName || "Patient"}-${lastName || "Unknown"}-${formatted}.pdf`;
    const outputDir = path.join(process.cwd(), "output");
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, fileName);

    // ✨ NEW: Save HTML preview in a dedicated folder and open in browser
    const previewsDir = path.join(process.cwd(), "previews");
    fs.mkdirSync(previewsDir, { recursive: true });

    const patientSlug = `${firstName || "Patient"}-${lastName || "Unknown"}`;
    const previewPath = path.join(previewsDir, `${patientSlug}-preview.html`);
    fs.writeFileSync(previewPath, html);

    console.log(`💾 Preview saved: ${previewPath}`);

    // Open the preview in the default browser
    /*
    const { exec } = await import("child_process");
    const openCmd =
      process.platform === "darwin"
        ? "open"
        : process.platform === "win32"
        ? "start"
        : "xdg-open";

    exec(`${openCmd} "${previewPath}"`, (err) => {
      if (err)
        console.error("⚠️  Could not open preview in browser:", err.message);
      else console.log(`🌐 Preview opened in browser: ${previewPath}`);
    });
    */

    // 4️⃣ Use Puppeteer to generate PDF
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      margin: { top: "30px", bottom: "30px" },
    });
    await browser.close();

    console.log(`✅ PDF generated successfully: ${outputPath}`);
    return outputPath;
  } catch (err) {
    console.error(`❌ Error generating PDF for ${jsonPath}: ${err.message}`);
    return null;
  }
}

// ============================
// 🧩 CLI Execution Guard
// ============================
// Only runs when called directly via the command line.
if (import.meta.url === `file://${process.argv[1]}`) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("❌ Please provide a JSON input path.");
    process.exit(1);
  } else {
    generatePDF(inputPath);
  }
}