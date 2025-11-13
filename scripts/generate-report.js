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

    // Compile template with data
    const baseHtml = template(data);
    
    // Prepare paths
    const cssPath = path.join(process.cwd(), "templates", "styles.css");
    const iconsDir = path.join(process.cwd(), "templates", "icons");
    const fontsDir = path.join(process.cwd(), "templates", "fonts");
    
    // Create HTML with relative paths for preview (works when shared with others)
    const htmlPreview = baseHtml
      .replace('<link rel="stylesheet" href="../templates/styles.css" />', '<link rel="stylesheet" href="../templates/IGNORE_styles.css" />')
      .replace(/src="\.\/icons\//g, 'src="../templates/icons/')
      .replace(/src="icons\//g, 'src="../templates/icons/')
      .replace(/url\(\.\.\/fonts\//g, 'url(../templates/fonts/');
    
    // Create HTML with absolute paths for PDF generation (works with Puppeteer)
    // Convert Windows paths to proper file:// URLs
    const cssPathUrl = cssPath.replace(/\\/g, '/');
    const iconsDirUrl = iconsDir.replace(/\\/g, '/');
    const fontsDirUrl = fontsDir.replace(/\\/g, '/');
    
    const cssLink = `<link rel="stylesheet" href="file:///${cssPathUrl}" />`;
    const htmlPdf = baseHtml
      .replace('<link rel="stylesheet" href="../templates/styles.css" />', cssLink)
      .replace(/src="\.\/icons\//g, `src="file:///${iconsDirUrl}/`)
      .replace(/src="icons\//g, `src="file:///${iconsDirUrl}/`)
      .replace(/url\(\.\.\/fonts\//g, `url(file:///${fontsDirUrl}/`);

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

    // ✨ Save HTML preview in a dedicated folder
    const previewsDir = path.join(process.cwd(), "previews");
    fs.mkdirSync(previewsDir, { recursive: true });

    const patientSlug = `${firstName || "Patient"}-${lastName || "Unknown"}`;
    const previewPath = path.join(previewsDir, `${patientSlug}-preview.html`);
    fs.writeFileSync(previewPath, htmlPreview);

    console.log(`💾 Preview saved: ${previewPath}`);

    // Save a separate HTML file for PDF generation with absolute paths
    const pdfHtmlPath = path.join(previewsDir, `${patientSlug}-pdf-temp.html`);
    fs.writeFileSync(pdfHtmlPath, htmlPdf);

    // 4️⃣ Use Puppeteer to generate PDF
    // Use page.goto() instead of setContent() to properly load local file:// resources
    const browser = await puppeteer.launch({ 
      headless: true,
      args: ['--allow-file-access-from-files', '--disable-web-security']
    });
    const page = await browser.newPage();
    
    // Convert path to file:// URL
    const pdfHtmlUrl = `file:///${pdfHtmlPath.replace(/\\/g, '/')}`;
    await page.goto(pdfHtmlUrl, { waitUntil: "networkidle0" });
    
    // Set viewport to 1440px width (standard desktop width)
    const pageWidth = 1440;
    await page.setViewport({ width: pageWidth, height: 1080 });
    
    // Get the full height of the document after viewport is set
    const bodyHeight = await page.evaluate(() => {
      return document.body.scrollHeight;
    });
    
    // Generate PDF with custom dimensions matching full document
    await page.pdf({
      path: outputPath,
      width: `${pageWidth}px`,
      height: `${bodyHeight}px`,
      printBackground: true,
      margin: { top: "0px", bottom: "0px", left: "0px", right: "0px" },
    });
    await browser.close();
    
    // Clean up temporary PDF HTML file
    fs.unlinkSync(pdfHtmlPath);

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