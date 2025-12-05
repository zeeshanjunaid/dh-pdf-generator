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

// Split string by delimiter and trim each item
Handlebars.registerHelper("split", function(str, delimiter) {
  if (!str) return [];
  return str.split(delimiter).map(item => item.trim()).filter(item => item.length > 0);
});

// Split by newlines or comma, handling actual newline characters
Handlebars.registerHelper("splitLines", function(str, delimiter) {
  if (!str) return [];
  
  // Convert to string in case it's not
  const text = String(str);
  
  // Handlebars passes an options hash as the last parameter, so check if delimiter is actually a string
  // If delimiter is the options object, treat it as undefined
  const actualDelimiter = (typeof delimiter === 'string') ? delimiter : undefined;
  
  // If delimiter is provided (e.g., comma for Medical), use it
  if (actualDelimiter) {
    return text.split(actualDelimiter).map(item => item.trim()).filter(item => item.length > 0);
  }
  
  // Otherwise split by newlines (for Surgical/Radiation)
  // JSON.parse converts \n in JSON strings to actual newline characters (char code 10)
  // Split by any newline variant
  return text.split(/[\r\n]+/).map(item => item.trim()).filter(item => item.length > 0);
});

// Strip bullet points (• or -) from the beginning of strings
Handlebars.registerHelper("stripBullet", function(str) {
  if (!str) return "";
  // Remove bullet point (•), dash (-), or asterisk (*) followed by optional spaces from the start
  return String(str).replace(/^[•\-\*]\s*/, "").trim();
});

// Group questions by section and topic
Handlebars.registerHelper("groupQuestions", function(items) {
  if (!items || !Array.isArray(items)) return [];
  
  const grouped = {};
  
  items.forEach(item => {
    if (!grouped[item.section]) {
      grouped[item.section] = {};
    }
    if (!grouped[item.section][item.topic]) {
      grouped[item.section][item.topic] = [];
    }
    grouped[item.section][item.topic].push(item);
  });
  
  // Convert to array format for template iteration
  const result = [];
  Object.keys(grouped).forEach(section => {
    const topics = [];
    Object.keys(grouped[section]).forEach(topic => {
      topics.push({
        name: topic,
        questions: grouped[section][topic]
      });
    });
    result.push({
      section: section,
      topics: topics
    });
  });
  
  return result;
});

// Parse flexible date formats (handles both ISO and JS Date.toString() formats)
Handlebars.registerHelper("parseDate", function(dateString) {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch (e) {
    return dateString;
  }
});

// Filter tests by status (for testing_and_consultations)
Handlebars.registerHelper("filterByStatus", function(tests, status, options) {
  if (!tests || !Array.isArray(tests)) return options.inverse(this);
  const filtered = tests.filter(t => t.status && t.status.toLowerCase() === status.toLowerCase());
  if (filtered.length === 0) return options.inverse(this);
  return filtered.map(t => options.fn(t)).join('');
});

// Check if any tests exist with a specific status
Handlebars.registerHelper("hasTestsWithStatus", function(tests, status, options) {
  if (!tests || !Array.isArray(tests)) return options.inverse(this);
  const hasTests = tests.some(t => t.status && t.status.toLowerCase() === status.toLowerCase());
  return hasTests ? options.fn(this) : options.inverse(this);
});

// Get record title (prefer patient_facing_title over document_name over name)
Handlebars.registerHelper("getRecordTitle", function(record) {
  return record?.patient_facing_title || record?.document_name || record?.name || 'Unknown Record';
});

// Check if object has a value property with content
Handlebars.registerHelper("hasValue", function(obj, options) {
  if (!obj || !obj.value || obj.value === '') return options.inverse(this);
  return options.fn(this);
});

// Filter tests by status and category (tests vs referrals), sorted by date (oldest first)
Handlebars.registerHelper("filterTestsByTypeAndStatus", function(tests, isReferral, status, options) {
  if (!tests || !Array.isArray(tests)) return options.inverse(this);
  
  const referralKeywords = ['referral', 'consultation'];
  
  const filtered = tests.filter(t => {
    // Check status match
    if (!t.status || t.status.toLowerCase() !== status.toLowerCase()) return false;
    
    // Check if it's a referral or test
    const testName = (t.test_name || '').toLowerCase();
    const isTestReferral = referralKeywords.some(keyword => testName.includes(keyword));
    
    return isReferral ? isTestReferral : !isTestReferral;
  });
  
  if (filtered.length === 0) return options.inverse(this);
  
  // Sort by date (oldest first)
  filtered.sort((a, b) => {
    const dateA = new Date(a.test_date || a.service_date || a.referral_date || 0);
    const dateB = new Date(b.test_date || b.service_date || b.referral_date || 0);
    return dateA - dateB;
  });
  
  return filtered.map(t => options.fn(t)).join('');
});

// Check if any tests exist with specific type and status (for completed/scheduled tests)
Handlebars.registerHelper("hasTestsOfType", function(tests, isReferral, status, options) {
  if (!tests || !Array.isArray(tests)) return options.inverse(this);
  
  const referralKeywords = ['referral', 'consultation'];
  
  const hasTests = tests.some(t => {
    if (!t.status || t.status.toLowerCase() !== status.toLowerCase()) return false;
    const testName = (t.test_name || '').toLowerCase();
    const isTestReferral = referralKeywords.some(keyword => testName.includes(keyword));
    return isReferral ? isTestReferral : !isTestReferral;
  });
  
  return hasTests ? options.fn(this) : options.inverse(this);
});

// Check if any tests exist with likelihood (for "may consider" sections)
Handlebars.registerHelper("hasTestsWithLikelihood", function(tests, isReferral, options) {
  if (!tests || !Array.isArray(tests)) return options.inverse(this);
  
  const referralKeywords = ['referral', 'consultation'];
  
  const hasTests = tests.some(t => {
    const likelihood = (t.likelihood || '').trim();
    if (!likelihood || likelihood.toLowerCase() === 'completed') return false;
    
    const testName = (t.test_name || '').toLowerCase();
    const isTestReferral = referralKeywords.some(keyword => testName.includes(keyword));
    return isReferral ? isTestReferral : !isTestReferral;
  });
  
  return hasTests ? options.fn(this) : options.inverse(this);
});

// Filter tests by type (tests vs referrals) with likelihood, sorted by likelihood (highest risk first)
// Shows tests where likelihood is not blank and not "Completed"
Handlebars.registerHelper("filterByLikelihood", function(tests, isReferral, options) {
  if (!tests || !Array.isArray(tests)) return options.inverse(this);
  
  const referralKeywords = ['referral', 'consultation'];
  
  const filtered = tests.filter(t => {
    // Filter criteria: likelihood != blank AND likelihood != "Completed"
    const likelihood = (t.likelihood || '').trim();
    if (!likelihood || likelihood.toLowerCase() === 'completed') return false;
    
    // Check if it's a referral or test
    const testName = (t.test_name || '').toLowerCase();
    const isTestReferral = referralKeywords.some(keyword => testName.includes(keyword));
    
    return isReferral ? isTestReferral : !isTestReferral;
  });
  
  if (filtered.length === 0) return options.inverse(this);
  
  // Sort by likelihood (highest risk first)
  // Priority: "Highly Likely" > any other likelihood text
  filtered.sort((a, b) => {
    const likelihoodA = (a.likelihood || '').toLowerCase();
    const likelihoodB = (b.likelihood || '').toLowerCase();
    
    // Highly Likely comes first
    if (likelihoodA.includes('highly likely') && !likelihoodB.includes('highly likely')) return -1;
    if (!likelihoodA.includes('highly likely') && likelihoodB.includes('highly likely')) return 1;
    
    return 0; // Keep original order if same priority
  });
  
  return filtered.map(t => options.fn(t)).join('');
});

// Sort array by date field (oldest first)
Handlebars.registerHelper("sortByDate", function(array, dateField, options) {
  if (!array || !Array.isArray(array)) return options.inverse(this);
  
  const sorted = [...array].sort((a, b) => {
    const dateA = new Date(a[dateField] || 0);
    const dateB = new Date(b[dateField] || 0);
    return dateA - dateB;
  });
  
  return sorted.map(item => options.fn(item)).join('');
});

// Calculate percentage for stage circle based on stage value
Handlebars.registerHelper("getStagePercent", function(stageValue) {
  if (!stageValue) return 15;
  const stage = stageValue.toLowerCase();
  
  // Stage 0, I, IA, IB = Early = 15%
  if (stage.includes('stage 0') || stage === 'stage i' || stage.includes('stage ia') || stage.includes('stage ib')) {
    return 15;
  }
  // Stage II, IIA, IIB = Intermediate = 30%
  if (stage.includes('stage ii')) {
    return 30;
  }
  // Stage III, IIIA, IIIB, IIIC = Advanced = 45%
  if (stage.includes('stage iii')) {
    return 45;
  }
  // Stage IV = Metastatic = 60%
  if (stage.includes('stage iv')) {
    return 60;
  }
  return 15; // Default
});

// Calculate percentage for grade circle based on grade value
Handlebars.registerHelper("getGradePercent", function(gradeValue) {
  if (!gradeValue) return 15;
  const grade = gradeValue.toLowerCase();
  
  // Grade 1 = Low = 15%
  if (grade.includes('grade 1')) {
    return 15;
  }
  // Grade 2 = Intermediate = 30%
  if (grade.includes('grade 2')) {
    return 30;
  }
  // Grade 3 = High = 45%
  if (grade.includes('grade 3')) {
    return 45;
  }
  // Grade X = Unknown = 15%
  if (grade.includes('grade x')) {
    return 15;
  }
  return 15; // Default
});

// Calculate percentage for HER2 circle based on HER2 status
Handlebars.registerHelper("getHER2Percent", function(her2Value) {
  if (!her2Value) return 15;
  const her2 = her2Value.toLowerCase();
  
  // HER2 negative = Baseline = 15%
  if (her2.includes('negative')) {
    return 15;
  }
  // HER2 ultralow = Slight expression = 25%
  if (her2.includes('ultralow')) {
    return 25;
  }
  // HER2 low = Low expression = 35%
  if (her2.includes('low') && !her2.includes('ultralow')) {
    return 35;
  }
  // HER2 positive = High expression = 45%
  if (her2.includes('positive')) {
    return 45;
  }
  // Unknown = Not available = 15%
  if (her2.includes('unknown')) {
    return 15;
  }
  return 15; // Default
});

// Helper to filter summaries by match_value against patient's stage
Handlebars.registerHelper("filterSummaries", function(summaries, patientStage, options) {
  if (!summaries || summaries.length === 0) return '';
  if (!patientStage) patientStage = '';
  
  // Filter summaries that match the patient's stage
  const matching = summaries.filter(s => {
    if (!s.match_value) return true; // Show if no match_value specified
    return patientStage.toLowerCase().includes(s.match_value.toLowerCase()) ||
           s.match_value.toLowerCase().includes(patientStage.toLowerCase());
  });
  
  // If no matches found, show all summaries
  const toDisplay = matching.length > 0 ? matching : summaries;
  
  return toDisplay.map(summary => options.fn(summary)).join('');
});

// Parse ER status from combined erpr_status value
Handlebars.registerHelper("getERStatus", function(erprValue) {
  if (!erprValue) return { status: 'Unknown', symbol: '-' };
  const value = erprValue.toLowerCase();
  if (value.includes('er positive')) return { status: 'Positive', symbol: '+' };
  if (value.includes('er negative')) return { status: 'Negative', symbol: '-' };
  return { status: 'Unknown', symbol: '-' };
});

// Parse PR status from combined erpr_status value
Handlebars.registerHelper("getPRStatus", function(erprValue) {
  if (!erprValue) return { status: 'Unknown', symbol: '-' };
  const value = erprValue.toLowerCase();
  if (value.includes('pr positive')) return { status: 'Positive', symbol: '+' };
  if (value.includes('pr negative')) return { status: 'Negative', symbol: '-' };
  return { status: 'Unknown', symbol: '-' };
});

// Group treatments by treatment_section, then by table_title
// Returns: [{section, section_name, tables: [{title, description, rows: [...]}]}]
Handlebars.registerHelper("groupTreatments", function(treatments, options) {
  if (!treatments || !Array.isArray(treatments) || treatments.length === 0) {
    return options.inverse(this);
  }
  
  const sections = {};
  
  treatments.forEach(treatment => {
    const sectionKey = treatment.treatment_section || "Other";
    const tableTitle = treatment.table_title || "Treatments";
    
    if (!sections[sectionKey]) {
      sections[sectionKey] = {
        section: sectionKey,
        section_name: sectionKey.replace(/^\d+\s*-\s*/, ''), // Remove "1 - " prefix
        tables: {}
      };
    }
    
    if (!sections[sectionKey].tables[tableTitle]) {
      sections[sectionKey].tables[tableTitle] = {
        title: tableTitle,
        description: treatment.table_description || '',
        rows: []
      };
    }
    
    sections[sectionKey].tables[tableTitle].rows.push(treatment);
  });
  
  // Convert to arrays and sort
  const sectionsArray = Object.values(sections).map(section => ({
    ...section,
    tables: Object.values(section.tables).map(table => ({
      ...table,
      rows: table.rows.sort((a, b) => (a.row_order || 0) - (b.row_order || 0))
    }))
  }));
  
  // Sort sections by key (1 - Medical, 2 - Surgical, 3 - Radiation)
  sectionsArray.sort((a, b) => a.section.localeCompare(b.section));
  
  return sectionsArray.map(section => options.fn(section)).join('');
});

// Group questions by section and topic
Handlebars.registerHelper("groupQuestionsBySection", function(questions, sectionName, options) {
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return options.inverse(this);
  }
  
  const filtered = questions.filter(q => q.section === sectionName);
  
  if (filtered.length === 0) return options.inverse(this);
  
  // Group by topic
  const grouped = {};
  filtered.forEach(q => {
    const topic = q.topic || 'General';
    if (!grouped[topic]) {
      grouped[topic] = [];
    }
    grouped[topic].push(q);
  });
  
  // Convert to array format
  const topicsArray = Object.entries(grouped).map(([topic, questions]) => ({
    topic,
    questions
  }));
  
  return topicsArray.map(topicGroup => options.fn(topicGroup)).join('');
});

// Check if any questions exist for a section
Handlebars.registerHelper("hasQuestionsForSection", function(questions, sectionName, options) {
  if (!questions || !Array.isArray(questions) || questions.length === 0) {
    return options.inverse(this);
  }
  
  const hasQuestions = questions.some(q => q.section === sectionName);
  return hasQuestions ? options.fn(this) : options.inverse(this);
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