import fs from "fs";
import path from "path";
import chalk from "chalk";

function getNested(obj, path) {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let current = obj;
  for (const part of parts) {
    if (part.endsWith("[]")) {
      const arrayKey = part.slice(0, -2);
      current = current[arrayKey];
      if (!Array.isArray(current)) {
        return undefined;
      }
    } else if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || index < 0 || index >= current.length) {
        return undefined;
      }
      current = current[index];
    } else if (current && typeof current === "object") {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function validateJsonSchema(jsonData, filename = "unknown.json") {
  const tier1Required = [
    "patientFirstName",
    "patientLastName",
    "patientDateOfBirth",
    "patientEmail",
    "reportDate",
    "diagnosisSummary",
    "tumors",
    "whatThisMeans",
    "testsCompleted",
    "testsNeeded",
    "treatmentTeam"
  ];

  const tier2Recommended = [
    "diagnosisDate",
    "resources",
    "contactInfo",
    "contactInfo.phone",
    "contactInfo.email"
  ];

  const tier3StructuralRequired = [
    "tumors[].name",
    "tumors[].location",
    "tumors[].stage",
    "tumors[].grade",
    "tumors[].hormoneReceptorStatus",
    "tumors[].her2Status",
    "whatThisMeans.goodNews",
    "whatThisMeans.newOptions",
    "whatThisMeans.treatmentFocus",
    "testsCompleted[].name",
    "testsCompleted[].date",
    "testsCompleted[].explanation",
    "testsNeeded[].name",
    "testsNeeded[].date",
    "testsNeeded[].explanation",
    "treatmentTeam.oncologist",
    "treatmentTeam.surgeon",
    "treatmentTeam.radiologist"
  ];

  let hasErrors = false;

  // Tier 1: Required fields
  for (const field of tier1Required) {
    const value = getNested(jsonData, field);
    if (value === undefined || value === null || value === "") {
      console.error(chalk.red(`❌ Missing required field: ${field}`));
      hasErrors = true;
    }
  }

  // Tier 3: Structural required fields (should exist and have correct types)
  for (const field of tier3StructuralRequired) {
    if (field.includes("[]")) {
      const [arrayKey, subPath] = field.split("[].");
      const array = getNested(jsonData, arrayKey);
      if (!Array.isArray(array) || array.length === 0) {
        console.error(chalk.red(`❌ Missing or empty array for structural required field: ${arrayKey}`));
        hasErrors = true;
        continue;
      }
      for (let i = 0; i < array.length; i++) {
        const value = getNested(array[i], subPath);
        if (value === undefined || value === null || value === "") {
          console.error(chalk.red(`❌ Missing structural required field: ${arrayKey}[${i}].${subPath}`));
          hasErrors = true;
        }
      }
    } else {
      const value = getNested(jsonData, field);
      if (value === undefined || value === null) {
        console.error(chalk.red(`❌ Missing structural required field: ${field}`));
        hasErrors = true;
      }
    }
  }

  // Tier 2: Recommended fields
  for (const field of tier2Recommended) {
    const value = getNested(jsonData, field);
    if (value === undefined || value === null || value === "") {
      console.warn(chalk.yellow(`⚠️ Recommended field missing or empty: ${field}`));
    }
  }

  // Example format check: patientDateOfBirth YYYY-MM-DD
  const dob = getNested(jsonData, "patientDateOfBirth");
  if (dob !== undefined && dob !== null && dob !== "") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      console.error(chalk.red(`❌ patientDateOfBirth must be in YYYY-MM-DD format`));
      hasErrors = true;
    }
  }

  if (hasErrors) {
    console.error(chalk.red(`❌ Validation failed for ${filename}`));
    return false;
  }

  console.log(chalk.green(`✅ JSON validated successfully: ${filename}`));
  return true;
}