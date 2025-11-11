import fs from "fs-extra";
import path from "path";
import { google } from "googleapis";
import { generatePDF } from "./generate-report.js";
import { getConfig } from "../config/config.js";
import mime from 'mime-types';
// --- 🧮 Local file hashing helper (for change detection) ---
import crypto from 'crypto';

async function waitForStableFile(filePath, interval = 150, retries = 25) {
  let prevSize = 0;
  for (let i = 0; i < retries; i++) {
    const { size } = fs.statSync(filePath);
    if (size > 0 && size === prevSize) {
      console.log(`🕒 File stabilized: ${filePath}`);
      return true;
    }
    prevSize = size;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`File ${filePath} never stabilized after download.`);
}

const __dirname = path.resolve();
const localDir = path.join(__dirname, "data");
fs.ensureDirSync(localDir);

import dotenv from "dotenv";
dotenv.config({ path: "./.env" });

function getFileHash(filePath) {
  try {
    const data = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(data).digest('hex');
  } catch (err) {
    console.error(`⚠️ Could not compute hash for ${filePath}:`, err.message);
    return null;
  }
}

let targetFolderId;


/**
 * Uploads a file (PDF) to Google Drive, preserving binary integrity.
 * Ensures Drive recognizes the file as a real PDF, not a text stream.
 */
async function uploadFileToDrive(drive, filePath, outputFolderId) {
  try {
    const fileMetadata = {
      name: path.basename(filePath),
      parents: [outputFolderId],
    };

    const media = {
      mimeType: 'application/pdf',
      body: fs.createReadStream(filePath),
    };

    const uploadedFile = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink',
      supportsAllDrives: true, // ✅ this is key for Shared Drives
    });

    const cleanName = path.basename(filePath).replace(/^Diagnostic-Report-/, '');
    console.log(`⬆️  Uploaded ${cleanName} to Drive: ${uploadedFile.data.webViewLink}`);
    return uploadedFile.data;
  } catch (error) {
    console.error(`❌ Error uploading ${filePath}:`, error.message);
    throw error;
  }
}

/**
 * Uploads a JSON file to Google Drive with correct MIME type.
 */
async function uploadJsonToDrive(drive, filePath, outputFolderId) {
  try {
    const fileMetadata = {
      name: path.basename(filePath),
      parents: [outputFolderId],
    };

    const media = {
      mimeType: 'application/json',
      body: fs.createReadStream(filePath),
    };

    const uploadedFile = await drive.files.create({
      resource: fileMetadata,
      media,
      fields: 'id, webViewLink',
      supportsAllDrives: true,
    });

    console.log(`⬆️  Uploaded ${path.basename(filePath)} as JSON: ${uploadedFile.data.webViewLink}`);
    return uploadedFile.data;
  } catch (error) {
    console.error(`❌ Error uploading JSON ${filePath}:`, error.message);
    throw error;
  }
}

async function getOutputFolderId(drive, parentFolderId) {
  const res = await drive.files.list({
    q: `'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='output' and trashed = false`,
    fields: 'files(id, name)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const folder = res.data.files?.[0];
  if (!folder) throw new Error("❌ Output folder not found in Drive");
  console.log(`📁 Drive output folder found: ${folder.id}`);
  return folder.id;
}

const config = getConfig();
const keyFile = path.join(__dirname, "config", "service-account.json");
const folderId = config.driveFolderId;

console.log(`🔐 Using key file: ${keyFile}`);

async function authenticate() {
  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });
  const drive = google.drive({ version: "v3", auth });
  const info = await auth.getClient();
  console.log(`🔑 Authenticated as: ${info.email}`);
  return drive;
}

async function listJsonFiles(drive, outputFolderId) {
  // Find the parent of the output folder
  const outputMeta = await drive.files.get({
    fileId: outputFolderId,
    fields: "id, name, parents",
    supportsAllDrives: true,
  });
  const parentId = outputMeta.data.parents?.[0];
  if (!parentId) throw new Error("❌ Could not locate parent of output folder.");

  // Now find 'data' inside that parent
  const folderRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='data' and trashed = false`,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const dataFolder = folderRes.data.files?.[0];
  if (!dataFolder) throw new Error("❌ 'data' folder not found at same level as 'output' folder.");

  console.log(`📁 Found data folder: ${dataFolder.id}`);

  // Now list JSON files inside the data folder
  const res = await drive.files.list({
    q: `'${dataFolder.id}' in parents and name contains '.json' and trashed = false`,
    fields: "files(id, name, mimeType, modifiedTime)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const files = res.data.files || [];
  if (!files.length) {
    console.log("✅ Connected successfully, but no JSON files found in the 'data' folder.");
    return [];
  }

  console.log(`📁 Found ${files.length} JSON file(s):`);
  files.forEach((f) => console.log(`   • ${f.name}`));
  return files;
}

async function downloadFile(drive, fileId, destPath, attempt = 1) {
  if (!destPath || destPath === ".") {
    throw new Error(`Invalid destination path: ${destPath}`);
  }

  const MAX_RETRIES = 3;

  try {
    const dest = fs.createWriteStream(destPath);

    // Request the file stream from Google Drive
    const res = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "stream" }
    );

    // Pipe data into local file
    res.data.pipe(dest);

    // Wait for file stream to complete and stabilize
    await new Promise((resolve, reject) => {
      dest.on("finish", async () => {
        try {
          console.log(`⏳ Waiting for file to stabilize: ${destPath}`);
          await waitForStableFile(destPath);
          console.log(`✅ File ready: ${destPath}`);
          // 🧪 Validate JSON integrity after stabilization
          try {
            const content = fs.readFileSync(destPath, 'utf8');
            JSON.parse(content);
          } catch (err) {
            console.error(`⚠️ Detected malformed JSON in ${destPath}: ${err.message}`);
            if (attempt < MAX_RETRIES) {
              console.log(`🔁 Retrying download due to invalid JSON (${attempt + 1}/${MAX_RETRIES})...`);
              await new Promise(r => setTimeout(r, 500 * attempt));
              return resolve(await downloadFile(drive, fileId, destPath, attempt + 1));
            } else {
              return reject(new Error(`Failed JSON validation after ${MAX_RETRIES} attempts: ${destPath}`));
            }
          }
          resolve();
        } catch (err) {
          reject(err);
        }
      });
      dest.on("error", reject);
    });

  } catch (err) {
    console.error(`❌ Error downloading ${destPath} (Attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);

    if (attempt < MAX_RETRIES) {
      console.log(`🔁 Retrying download (${attempt + 1}/${MAX_RETRIES})...`);
      await new Promise(r => setTimeout(r, 500 * attempt)); // backoff delay
      return downloadFile(drive, fileId, destPath, attempt + 1);
    } else {
      throw new Error(`Failed to download ${destPath} after ${MAX_RETRIES} attempts`);
    }
  }
}

async function processFiles() {
  try {
    const skippedFiles = [];
    const uploadedPDFs = [];
    const errors = [];

    const drive = await authenticate();
    console.log("🔑 Authenticated. Looking for JSON files...");

    if (process.env.FORCE_UPLOAD === "true") {
      console.log("🚀 FORCE_UPLOAD active — skipping all change detection checks.");
      console.log("⚙️ FORCE_UPLOAD is active — all PDFs will be regenerated and re-uploaded.");
    }

  const outputFolderId = process.env.PDF_OUTPUT_FOLDER_ID || config.driveFolderId;
  if (process.env.PDF_OUTPUT_FOLDER_ID) {
    console.log(`📁 Using PDF_OUTPUT_FOLDER_ID from .env: ${outputFolderId}`);
  } else {
    console.log(`📁 Using DRIVE_FOLDER_ID as fallback output folder: ${outputFolderId}`);
  }

  // 🔍 Get Drive JSON file list first (so we can skip re-uploading them)
  const driveFiles = await listJsonFiles(drive, folderId);
  const driveFileNames = new Set(driveFiles.map(f => f.name));

  // ✅ Only include truly local JSONs not already present in Drive
  const localFiles = fs.readdirSync(localDir)
    .filter(f => f.endsWith(".json") && !driveFileNames.has(f))
    .map(f => ({ name: f, localOnly: true }));

  console.log(`📂 Found ${localFiles.length} local-only JSON file(s) not on Drive`);

  // --- 🧹 Deduplicate Drive JSON files helper ---
  async function dedupeDriveJsonFiles(drive, dataFolderId) {
    console.log("🧹 Deduping Drive JSON files...");
    const res = await drive.files.list({
      q: `'${dataFolderId}' in parents and mimeType='application/json' and trashed = false`,
      fields: 'files(id, name, modifiedTime)',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });
    const files = res.data.files || [];
    const grouped = files.reduce((acc, file) => {
      (acc[file.name] = acc[file.name] || []).push(file);
      return acc;
    }, {});

    for (const [name, group] of Object.entries(grouped)) {
      if (group.length > 1) {
        // Sort by modifiedTime descending
        group.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
        const [newest, ...duplicates] = group;
        for (const dup of duplicates) {
          await drive.files.update({
            fileId: dup.id,
            requestBody: { trashed: true },
            supportsAllDrives: true,
          });
        console.log(`🗑️ Trashed ${duplicates.length} older duplicates for ${name}`);
      }
      }
    }
  }

  // Find data folder ID for dedupe
  const folderRes = await drive.files.list({
    q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and name='data' and trashed = false`,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const dataFolder = folderRes.data.files?.[0];
  if (!dataFolder) throw new Error("❌ 'data' folder not found at same level as 'output' folder.");

  await dedupeDriveJsonFiles(drive, dataFolder.id);

  // New: map drive file names to modifiedTime
  const driveFileMap = {};
  for (const df of driveFiles) {
    driveFileMap[df.name] = new Date(df.modifiedTime);
  }

  // Filter local files: skip if drive file exists with same name and newer or equal modifiedTime
  const filteredLocalFiles = localFiles.filter(localFile => {
    const driveMod = driveFileMap[localFile.name];
    if (driveMod) {
      const localPath = path.join(localDir, localFile.name);
      const localMod = fs.existsSync(localPath) ? fs.statSync(localPath).mtime : null;
      if (localMod && localMod <= driveMod) {
        console.log(`⏩ Skipping local file ${localFile.name} (Drive version is newer)`);
        return false;
      }
    }
    return true;
  });

  const files = [...(driveFiles || []), ...filteredLocalFiles];

  if (!files.length) {
    console.log("✅ No Drive or local JSON files found to process.");
    return;
  }

    // const files = await listJsonFiles(drive, folderId);
    // if (!files.length) return;

    for (const file of files) {
      // Handle local-only files (not yet on Drive)
      if (file.localOnly) {
        const localPath = path.join(localDir, file.name);
        console.log(`📄 Processing local-only file: ${file.name}`);
        try {
          const pdfPath = await generatePDF(localPath);
          // Removed duplicate console.log of PDF generated successfully here
          uploadedPDFs.push({
            file: path.basename(pdfPath),
            driveLink: null
          });
          const uploadedPDF = await uploadFileToDrive(drive, pdfPath, outputFolderId);
          const uploadedJSON = await uploadJsonToDrive(drive, localPath, process.env.JSON_OUTPUT_FOLDER_ID || folderId);
          console.log(`⬆️  Uploaded ${file.name} and ${path.basename(pdfPath)} to Drive`);
        } catch (err) {
          console.error(`❌ Error processing local-only file ${file.name}: ${err.message}`);
        }
        continue;
      }

      if (!file.name) {
        console.warn(`⚠️ Skipping file with missing name or metadata: ${JSON.stringify(file)}`);
        skippedFiles.push(file.name || "unknown");
        continue;
      }


      const localPath = path.join(localDir, file.name);

      // --- 🧩 Validate JSON before generating PDF ---
      try {
        JSON.parse(fs.readFileSync(localPath, 'utf8'));
      } catch (parseErr) {
        console.error(`❌ Malformed JSON (${file.name}): ${parseErr.message}`);
        errors.push({ file: file.name, error: parseErr.message });
        continue; // Skip bad JSON and move on to next file
      }

      // --- 🔍 Check JSON file for changes before regenerating ---
      const driveModified = new Date(file.modifiedTime);
      const forceUpload = process.env.FORCE_UPLOAD === "true";

      if (fs.existsSync(localPath)) {
        const localModified = fs.statSync(localPath).mtime;
        const localHash = getFileHash(localPath);
        const remoteHash = file.md5Checksum;

        if (forceUpload) {
          console.log(`⚙️ FORCE_UPLOAD enabled — regenerating ${file.name} regardless of changes`);
        } else {
          // --- 🧮 Skip unchanged files ---
          if (remoteHash && localHash && remoteHash === localHash) {
            console.log(`⏩ Skipping ${file.name} (no changes detected — hash match)`);
            skippedFiles.push(file.name);
            continue;
          } else if (!remoteHash && localModified >= driveModified) {
            console.log(`⏩ Skipping ${file.name} (no changes detected — timestamp fallback)`);
            skippedFiles.push(file.name);
            continue;
          }
        }
      }

      // --- ⬇️ Download the JSON from Drive ---
      console.log(`⬇️  Downloading ${file.name} to ${localPath}`);
      try {
        await downloadFile(drive, file.id, localPath);
        console.log(`✅ Downloaded ${file.name}`);
      } catch (err) {
        console.error(`❌ Failed to download ${file.name}: ${err.message}`);
        errors.push({ file: file.name, error: err.message });
        continue;
      }

      // --- 📄 Generate the PDF locally ---
      let pdfPath;
      try {
        pdfPath = await generatePDF(localPath);
        console.log(`✅ PDF generated successfully: ${pdfPath}`);
      } catch (err) {
        console.error(`⚠️ Error generating PDF for ${file.name}: ${err.message}`);
        errors.push({ file: file.name, error: err.message });
        continue;
      }

      // --- 📤 Upload generated PDF to Drive output folder ---
      if (pdfPath && fs.existsSync(pdfPath)) {
        try {
          const uploaded = await uploadFileToDrive(drive, pdfPath, outputFolderId);
          console.log(`⬆️  Uploaded ${path.basename(pdfPath)} to Drive: ${uploaded.webViewLink}`);
          uploadedPDFs.push({
            file: path.basename(pdfPath),
            driveLink: uploaded.webViewLink
          });
        } catch (err) {
          console.error(`❌ Failed to upload PDF ${pdfPath}:`, err.message);
          errors.push({ file: path.basename(pdfPath), error: err.message });
        }
      } else {
        console.warn(`⚠️ No PDF found for ${file.name}`);
        skippedFiles.push(file.name);
      }
    } // end for loop

    // --- 🧾 Summary section ---
    console.log(`\n🧾 Summary Report`);
    console.log(`──────────────────────────────`);
    console.log(`📦 Total JSONs found: ${files.length}`);
    console.log(`✅ PDFs generated: ${uploadedPDFs.length}`);
    console.log(`⏩ Skipped (unchanged): ${skippedFiles.length}`);
    console.log(`⚠️ Errors: ${errors.length}`);

    if (errors.length > 0) {
      console.log(`\nError Details:`);
      errors.forEach((err, idx) => {
        console.log(` ${idx + 1}. ${err.file} → ${err.error}`);
      });
    }

    console.log(`\n🕒 Completed at: ${new Date().toLocaleTimeString()}`);
    console.log(`──────────────────────────────\n`);

  } catch (err) {
    console.error("❌ Error during automation:", err.message);
  } // closes try/catch

} // closes processFiles()

processFiles(); // make sure you call it at the very end