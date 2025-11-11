import fs from "fs-extra";
import path from "path";
import { fileURLToPath } from "url";
import { createServer } from "http";
import { statSync } from "fs";
import chokidar from "chokidar";
import Handlebars from "handlebars";
import puppeteer from "puppeteer";
import open from "open";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const DATA_FILE = process.argv[2] || path.join(__dirname, "../data/2025.11.06-rpt-a.json");
const TEMPLATE_DIR = path.join(__dirname, "../templates");
const TEMPLATE_FILE = path.join(TEMPLATE_DIR, "report.hbs");
const OUTPUT_DIR = path.join(__dirname, "../output");
const PREVIEW_DIR = path.join(__dirname, "../previews");

// Register Handlebars helpers
Handlebars.registerHelper("eq", (a, b) => a === b);

let isGenerating = false;
let previewUrl = null;
let httpServer = null;
const SERVER_PORT = 3000;

// Start HTTP server for preview
function startServer() {
  if (httpServer) return Promise.resolve(); // Server already running
  
  return new Promise((resolve, reject) => {
    httpServer = createServer((req, res) => {
      const urlPath = req.url.split('?')[0];
      let filePath = path.join(PREVIEW_DIR, urlPath === '/' ? 'dev-preview.html' : urlPath);
      
      // Security: ensure file is within preview directory
      if (!filePath.startsWith(PREVIEW_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      
      // Default to dev-preview.html
      if (urlPath === '/' || urlPath === '') {
        filePath = path.join(PREVIEW_DIR, 'dev-preview.html');
      }
      
      fs.readFile(filePath)
        .then(content => {
          const ext = path.extname(filePath);
          const contentType = {
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.woff2': 'font/woff2'
          }[ext] || 'text/plain';
          
          const stats = statSync(filePath);
          const lastModified = stats.mtime.toUTCString();
          
          res.writeHead(200, {
            'Content-Type': contentType,
            'Last-Modified': lastModified,
            'Cache-Control': 'no-cache, no-store, must-revalidate',
            'Pragma': 'no-cache',
            'Expires': '0'
          });
          res.end(content);
        })
        .catch(err => {
          if (err.code === 'ENOENT') {
            res.writeHead(404);
            res.end('File not found');
          } else {
            res.writeHead(500);
            res.end('Server error');
          }
        });
    });
    
    httpServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(chalk.yellow(`⚠️  Port ${SERVER_PORT} in use, trying to use existing server...`));
        resolve();
      } else {
        reject(err);
      }
    });
    
    httpServer.listen(SERVER_PORT, () => {
      console.log(chalk.cyan(`🌐 HTTP server started on http://localhost:${SERVER_PORT}`));
      resolve();
    });
  });
}

async function generatePreview() {
  if (isGenerating) {
    return; // Skip if already generating
  }
  
  isGenerating = true;
  const startTime = Date.now();
  
  try {
    console.log(chalk.blue("🔄 Regenerating preview..."));
    
    // Load data
    const rawData = await fs.readFile(DATA_FILE, "utf8");
    const data = JSON.parse(rawData);
    
    // Load and compile template
    const templateSrc = await fs.readFile(TEMPLATE_FILE, "utf8");
    const template = Handlebars.compile(templateSrc);
    
    // Generate HTML
    let html = template(data);
    
    // Inject auto-refresh script for live reload
    const fileTimestamp = Date.now();
    const autoRefreshScript = `
    <script>
      (function() {
        let lastModified = ${fileTimestamp};
        let isChecking = false;
        const checkInterval = 2000; // Check every 2 seconds
        
        function checkForUpdates() {
          if (isChecking) return; // Prevent concurrent checks
          isChecking = true;
          
          const url = window.location.href.split('?')[0] + '?t=' + Date.now();
          fetch(url, { 
            method: 'HEAD',
            cache: 'no-store'
          })
            .then(response => {
              isChecking = false;
              const lastModifiedHeader = response.headers.get('Last-Modified');
              if (lastModifiedHeader) {
                const serverTime = new Date(lastModifiedHeader).getTime();
                if (serverTime > lastModified) {
                  console.log('🔄 File updated, reloading...');
                  lastModified = serverTime;
                  setTimeout(() => {
                    window.location.reload();
                  }, 100);
                }
              }
            })
            .catch(err => {
              isChecking = false;
              // Silently fail - don't spam console
            });
        }
        
        // Wait for page to fully load before starting checks
        if (document.readyState === 'complete') {
          setTimeout(() => {
            setInterval(checkForUpdates, checkInterval);
            console.log('🔄 Auto-refresh enabled');
          }, 1000);
        } else {
          window.addEventListener('load', () => {
            setTimeout(() => {
              setInterval(checkForUpdates, checkInterval);
              console.log('🔄 Auto-refresh enabled');
            }, 1000);
          });
        }
      })();
    </script>`;
    
    // Inject script before closing body tag, or at the end if no body tag
    if (html.includes('</body>')) {
      html = html.replace('</body>', autoRefreshScript + '</body>');
    } else {
      html += autoRefreshScript;
    }
    
    // Create preview file
    await fs.ensureDir(PREVIEW_DIR);
    const previewPath = path.join(PREVIEW_DIR, "dev-preview.html");
    await fs.writeFile(previewPath, html, "utf8");
    
    // Generate PDF
    await fs.ensureDir(OUTPUT_DIR);
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
    
    const pdfFileName = `${firstName || "Patient"}-${lastName || "Unknown"}-${formatted}.pdf`;
    const pdfPath = path.join(OUTPUT_DIR, pdfFileName);
    
    // Generate PDF with Puppeteer
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    await page.pdf({
      path: pdfPath,
      format: "A4",
      printBackground: true,
      margin: { top: "30px", bottom: "30px" },
    });
    await browser.close();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(chalk.green(`✅ Preview regenerated in ${duration}s`));
    console.log(chalk.gray(`   HTML: ${previewPath}`));
    console.log(chalk.gray(`   PDF:  ${pdfPath}`));
    
    // Open preview in browser (first time only)
    if (!previewUrl) {
      previewUrl = `http://localhost:${SERVER_PORT}/dev-preview.html`;
      await open(previewUrl);
      console.log(chalk.cyan(`🌐 Preview opened in browser at ${previewUrl}`));
    }
    
  } catch (err) {
    console.error(chalk.red(`❌ Error: ${err.message}`));
    if (err.stack) {
      console.error(chalk.gray(err.stack));
    }
  } finally {
    isGenerating = false;
  }
}

// Watch for changes
console.log(chalk.yellow("👀 Watching for changes..."));
console.log(chalk.gray(`   Template: ${TEMPLATE_FILE}`));
console.log(chalk.gray(`   Data:     ${DATA_FILE}`));
console.log(chalk.gray(`   Watching: ${TEMPLATE_DIR}`));
console.log("");

// Watch template files
const watcher = chokidar.watch([
  path.join(TEMPLATE_DIR, "**/*.hbs"),
  path.join(TEMPLATE_DIR, "**/*.css"),
], {
  ignored: /(^|[\/\\])\../, // ignore dotfiles
  persistent: true,
  ignoreInitial: false,
});

// Generate on file changes
watcher
  .on("change", (filePath) => {
    console.log(chalk.yellow(`📝 File changed: ${path.basename(filePath)}`));
    generatePreview();
  })
  .on("add", (filePath) => {
    console.log(chalk.yellow(`➕ File added: ${path.basename(filePath)}`));
    generatePreview();
  })
  .on("error", (error) => {
    console.error(chalk.red(`❌ Watcher error: ${error}`));
  });

// Start server and then generate preview
async function init() {
  try {
    await startServer();
    // Wait a bit for server to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    await generatePreview();
  } catch (err) {
    console.error(chalk.red(`❌ Failed to start: ${err.message}`));
    process.exit(1);
  }
}

init();

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log(chalk.yellow("\n👋 Stopping watcher and server..."));
  watcher.close();
  if (httpServer) {
    httpServer.close(() => {
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
});

