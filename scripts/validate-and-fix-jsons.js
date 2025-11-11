import fs from "fs";
import path from "path";

// Utility: Try a few cleanup heuristics
function tryFixJSON(content) {
  let fixed = content
    // Remove any invisible zero-width characters or BOM
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    // Remove trailing commas before closing braces/brackets
    .replace(/,\s*([}\]])/g, "$1")
    // Fix unescaped quotes inside strings
    .replace(/([^\\])"(.*?)"(?=[^:,{}\[\]"\\])/g, (m, p1, p2) => `${p1}"${p2.replace(/"/g, '\\"')}"`)
    // Remove duplicate closing braces/brackets
    .replace(/}\s*}/g, "}")
    // Trim whitespace
    .trim();

  try {
    JSON.parse(fixed);
    return fixed; // ✅ Successfully fixed
  } catch {
    return null; // ❌ Still invalid
  }
}

const dataDir = path.resolve("./data");
console.log("🔍 Validating and auto-fixing JSON files in:", dataDir);

const files = fs.readdirSync(dataDir).filter(f => f.endsWith(".json"));
let fixedCount = 0;
let errorCount = 0;

for (const file of files) {
  const fullPath = path.join(dataDir, file);
  let content = fs.readFileSync(fullPath, "utf8");

  try {
    JSON.parse(content);
    console.log(`✅ Valid: ${file}`);
  } catch (err) {
    console.error(`❌ Invalid: ${file}`);
    console.error(`   ↳ ${err.message}`);
    const fixed = tryFixJSON(content);
    if (fixed) {
      const backupPath = fullPath + ".bak";
      fs.copyFileSync(fullPath, backupPath);
      fs.writeFileSync(fullPath, fixed);
      console.log(`   💾 Fixed and backed up original → ${backupPath}`);
      fixedCount++;
    } else {
      console.error("   ⚠️ Could not auto-fix — manual check required.");
      errorCount++;
    }
  }
}

console.log("\n🧾 Summary");
console.log("──────────────────────────────");
console.log(`✅ Valid files: ${files.length - errorCount - fixedCount}`);
console.log(`🛠️  Auto-fixed: ${fixedCount}`);
console.log(`⚠️  Still invalid: ${errorCount}`);
console.log("──────────────────────────────");

if (errorCount === 0) {
  console.log("🎉 All JSONs are now valid!");
} else {
  console.log("⚠️ Some JSONs still need manual cleanup.");
}