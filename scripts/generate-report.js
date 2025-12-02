import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import Handlebars from "handlebars";
import { exec } from "child_process";

console.log("🧩 generate-report.js loaded from:", import.meta.url);

// Register a simple equality helper for section filtering
Handlebars.registerHelper("eq", (a, b) => a === b);

// Register block equality helper for conditional rendering
Handlebars.registerHelper("ifEq", function(a, b, options) {
  return a === b ? options.fn(this) : options.inverse(this);
});

// Register increment helper for index + 1
Handlebars.registerHelper("inc", function(value) {
  return parseInt(value) + 1;
});

// Register formatDate helper to format ISO dates
Handlebars.registerHelper("formatDate", function(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD
  } catch (e) {
    return dateString;
  }
});

// Extract stage indicator (e.g., "Stage IIB" -> "IIB", "Stage IA" -> "IA")
Handlebars.registerHelper("extractStageIndicator", function(stageValue) {
  if (!stageValue) return "--";
  // Remove "Stage " prefix and trim
  const indicator = stageValue.replace(/Stage\s*/i, "").trim();
  return indicator || "--";
});

// Extract grade number (e.g., "Grade 2" -> "2", "Grade 1" -> "1")
Handlebars.registerHelper("extractGradeNumber", function(gradeValue) {
  if (!gradeValue) return "--";
  // Extract the number from "Grade X"
  const match = gradeValue.match(/Grade\s*(\d+)/i);
  return match ? match[1] : "--";
});

// Format date nicely (e.g., "2025-10-14T00:00:00.000Z" -> "October 14, 2025")
Handlebars.registerHelper("formatDateNice", function(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return dateString;
  }
});

// Get current date formatted
Handlebars.registerHelper("currentDate", function() {
  return new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
});

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
    // Preview is in previews/Patient-Name/ so need ../../ to get to root
    const htmlPreview = baseHtml
      .replace('<link rel="stylesheet" href="../templates/styles.css" />', '<link rel="stylesheet" href="../../templates/IGNORE_styles.css" />')
      .replace(/src="\.\/icons\//g, 'src="../../templates/icons/')
      .replace(/src="icons\//g, 'src="../../templates/icons/')
      .replace(/url\(\.\.\/fonts\//g, 'url(../../templates/fonts/');
    
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
    // Support both new format (general_info) and old format (report.sections)
    let patientName = "Unknown Patient";
    if (data?.general_info?.fname?.value || data?.general_info?.lname?.value) {
      const fname = data.general_info.fname?.value || "";
      const lname = data.general_info.lname?.value || "";
      patientName = `${fname} ${lname}`.trim() || "Unknown Patient";
    } else if (data?.report?.sections) {
      patientName = data.report.sections.find((s) => s.id === "records_overview")?.fields?.patient_name || "Unknown Patient";
    }
    const nameParts = patientName.trim().split(" ");
    const firstName = nameParts[0] || "Unknown";
    const lastName = nameParts.slice(1).join("-") || "Patient";

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

    // ✨ Save HTML preview and JSON data in a dedicated folder per patient
    const previewsDir = path.join(process.cwd(), "previews");
    fs.mkdirSync(previewsDir, { recursive: true });

    const patientSlug = `${firstName || "Patient"}-${lastName || "Unknown"}`;
    
    // Create patient-specific subfolder
    const patientDir = path.join(previewsDir, patientSlug);
    fs.mkdirSync(patientDir, { recursive: true });
    
    // Save HTML preview
    const previewPath = path.join(patientDir, `${patientSlug}-preview.html`);
    fs.writeFileSync(previewPath, htmlPreview);
    
    // Save patient's JSON data file
    const patientJsonPath = path.join(patientDir, `${patientSlug}-data.json`);
    fs.writeFileSync(patientJsonPath, JSON.stringify(data, null, 2));

    console.log(`💾 Preview saved: ${previewPath}`);
    console.log(`📄 Patient data saved: ${patientJsonPath}`);

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
const isMainModule = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]));
if (isMainModule) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("❌ Please provide a JSON input path.");
    process.exit(1);
  } else {
    generatePDF(inputPath);
  }
}