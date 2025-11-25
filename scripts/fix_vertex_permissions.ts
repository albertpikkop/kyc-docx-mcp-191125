#!/usr/bin/env tsx
/**
 * Script to diagnose and fix Vertex AI permission issues
 * Run with: tsx scripts/fix_vertex_permissions.ts
 */

import "dotenv/config";
import { execSync } from "child_process";

const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT || "gpounj";
const location = process.env.GOOGLE_CLOUD_LOCATION || process.env.GCP_LOCATION || "us-central1";

console.log("🔍 Vertex AI Permission Diagnostic Tool\n");
console.log(`Project: ${projectId}`);
console.log(`Location: ${location}\n`);

function runCommand(cmd: string, description: string): { success: boolean; output: string } {
  console.log(`\n📋 ${description}...`);
  try {
    const output = execSync(cmd, { encoding: "utf-8", stdio: "pipe" });
    console.log(`✅ Success`);
    return { success: true, output };
  } catch (error: any) {
    console.log(`❌ Failed: ${error.message.split("\n")[0]}`);
    return { success: false, output: error.message };
  }
}

// Step 1: Check current authentication
console.log("\n" + "=".repeat(60));
console.log("STEP 1: Checking Authentication");
console.log("=".repeat(60));

const authCheck = runCommand(
  "gcloud auth list --format='value(account)'",
  "Checking authenticated accounts"
);

if (authCheck.success) {
  const accounts = authCheck.output.trim().split("\n").filter(Boolean);
  console.log(`   Authenticated as: ${accounts.join(", ")}`);
} else {
  console.log("\n⚠️  No authentication found. Run:");
  console.log("   gcloud auth login");
  console.log("   gcloud auth application-default login");
  process.exit(1);
}

// Step 2: Check project access
console.log("\n" + "=".repeat(60));
console.log("STEP 2: Checking Project Access");
console.log("=".repeat(60));

const projectCheck = runCommand(
  `gcloud projects describe ${projectId} --format="value(projectId)"`,
  `Checking access to project: ${projectId}`
);

if (!projectCheck.success) {
  console.log("\n⚠️  Cannot access project. Checking available projects...");
  const projectsCheck = runCommand(
    "gcloud projects list --format='value(projectId)' --limit=10",
    "Listing accessible projects"
  );
  
  if (projectsCheck.success) {
    const projects = projectsCheck.output.trim().split("\n").filter(Boolean);
    console.log(`\n📋 Available projects:`);
    projects.forEach(p => console.log(`   - ${p}`));
    console.log(`\n💡 To use a different project, set:`);
    console.log(`   export GOOGLE_CLOUD_PROJECT=<project-id>`);
  }
  
  console.log(`\n❌ Cannot proceed without project access.`);
  console.log(`\nPossible solutions:`);
  console.log(`1. Verify project ID is correct: ${projectId}`);
  console.log(`2. Request access from project owner`);
  console.log(`3. Use a different project you have access to`);
  process.exit(1);
}

console.log(`✅ Project ${projectId} is accessible`);

// Step 3: Check IAM permissions
console.log("\n" + "=".repeat(60));
console.log("STEP 3: Checking IAM Permissions");
console.log("=".repeat(60));

const currentAccount = authCheck.output.trim().split("\n")[0];
const iamCheck = runCommand(
  `gcloud projects get-iam-policy ${projectId} --flatten="bindings[].members" --filter="bindings.members:${currentAccount}" --format="table(bindings.role)"`,
  `Checking IAM roles for ${currentAccount}`
);

if (iamCheck.success && iamCheck.output.trim()) {
  console.log(`\n📋 Your roles:`);
  const roles = iamCheck.output.trim().split("\n").slice(1).filter(Boolean);
  roles.forEach(role => console.log(`   - ${role}`));
  
  const hasVertexRole = roles.some(role => 
    role.includes("Vertex AI") || 
    role.includes("aiplatform") ||
    role.includes("Owner") ||
    role.includes("Editor")
  );
  
  if (!hasVertexRole) {
    console.log(`\n⚠️  Missing Vertex AI permissions. You need one of:`);
    console.log(`   - roles/aiplatform.user (Vertex AI User)`);
    console.log(`   - roles/owner (Project Owner)`);
    console.log(`   - roles/editor (Editor)`);
    console.log(`\n💡 Ask your project admin to grant you the "Vertex AI User" role:`);
    console.log(`   gcloud projects add-iam-policy-binding ${projectId} \\`);
    console.log(`     --member="user:${currentAccount}" \\`);
    console.log(`     --role="roles/aiplatform.user"`);
  } else {
    console.log(`\n✅ You have sufficient permissions for Vertex AI`);
  }
} else {
  console.log(`\n⚠️  Could not check IAM permissions. You may need:`);
  console.log(`   - roles/aiplatform.user (Vertex AI User)`);
}

// Step 4: Check if Vertex AI API is enabled
console.log("\n" + "=".repeat(60));
console.log("STEP 4: Checking Vertex AI API Status");
console.log("=".repeat(60));

const apiCheck = runCommand(
  `gcloud services list --enabled --project=${projectId} --filter="name:aiplatform.googleapis.com" --format="value(name)"`,
  "Checking if Vertex AI API is enabled"
);

if (apiCheck.success && apiCheck.output.trim()) {
  console.log(`✅ Vertex AI API is enabled`);
} else {
  console.log(`\n⚠️  Vertex AI API is not enabled.`);
  console.log(`\n💡 Enable it with:`);
  console.log(`   gcloud services enable aiplatform.googleapis.com --project=${projectId}`);
  
  const enablePrompt = process.argv.includes("--enable-api");
  if (enablePrompt) {
    console.log(`\n🔄 Attempting to enable API...`);
    const enableCheck = runCommand(
      `gcloud services enable aiplatform.googleapis.com --project=${projectId}`,
      "Enabling Vertex AI API"
    );
    if (enableCheck.success) {
      console.log(`✅ Vertex AI API enabled successfully!`);
    }
  }
}

// Step 5: Check Application Default Credentials
console.log("\n" + "=".repeat(60));
console.log("STEP 5: Checking Application Default Credentials");
console.log("=".repeat(60));

const adcCheck = runCommand(
  "gcloud auth application-default print-access-token > /dev/null 2>&1 && echo 'OK' || echo 'NOT_SET'",
  "Checking Application Default Credentials"
);

if (adcCheck.output.includes("OK")) {
  console.log(`✅ Application Default Credentials are set`);
} else {
  console.log(`\n⚠️  Application Default Credentials not set.`);
  console.log(`\n💡 Set them with:`);
  console.log(`   gcloud auth application-default login`);
  console.log(`\nThis is required for Vertex AI SDK to authenticate.`);
}

// Summary
console.log("\n" + "=".repeat(60));
console.log("SUMMARY");
console.log("=".repeat(60));

console.log(`\nTo fix permission issues:`);
console.log(`\n1. Ensure you have access to project: ${projectId}`);
console.log(`2. Request "Vertex AI User" role from project admin`);
console.log(`3. Enable Vertex AI API: gcloud services enable aiplatform.googleapis.com --project=${projectId}`);
console.log(`4. Set Application Default Credentials: gcloud auth application-default login`);
console.log(`\nThen run the test again: npm run test:vertex`);

