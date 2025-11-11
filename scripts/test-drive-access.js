import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { google } from 'googleapis';

const FOLDER_ID = '1FYFL0N1tyg-TP590yC1MdTGD_pTTeLdx';

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: path.join(__dirname, "../config/service-account.json"),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  const drive = google.drive({ version: 'v3', auth });
  const client = await auth.getClient();
  console.log('🔑 Authenticated as:', client.email || '(service account)');

  try {

    // Check which drives the service account can see
    const drives = await drive.drives.list({
      pageSize: 10,
    });
    console.log('🧭 Shared Drives visible to this account:', drives.data.drives?.map(d => d.name) || '(none)');

    const res = await drive.files.list({
      q: `'${FOLDER_ID}' in parents`,
      fields: 'files(id, name, mimeType, modifiedTime, parents)',
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    });

    const files = res.data.files;

    for (const f of files) {
      console.log(`📄 ${f.name} (${f.mimeType})`);
      console.log(`   ↳ Folder ID: ${f.parents ? f.parents.join(', ') : '(no parent found)'}`);
    }

    if (!files.length) {
      console.log('✅ Connected successfully, but no files found in folder.');
    } else {
      console.log(`✅ Connected successfully! Found ${files.length} file(s):`);
      files.forEach(f =>
        console.log(`📄 ${f.name} (${f.mimeType}) - Last modified ${f.modifiedTime}`)
      );
    }
  } catch (err) {
    console.error('❌ Error accessing Google Drive:', err.message);
  }
}

main();