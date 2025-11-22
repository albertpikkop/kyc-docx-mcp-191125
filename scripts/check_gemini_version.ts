import { GEMINI_MODEL } from '../src/modelGemini.js';

// Strict assertion script to ensure we never regress below 2.5
function assertGeminiVersion() {
    const requiredVersion = 2.5;
    
    // Extract version number from string like "gemini-2.5-flash"
    const match = GEMINI_MODEL.match(/gemini-(\d+\.\d+)/);
    
    if (!match) {
        console.error(`❌ Invalid model format: ${GEMINI_MODEL}. Cannot verify version.`);
        process.exit(1);
    }
    
    const version = parseFloat(match[1]);
    
    if (version < requiredVersion) {
        console.error(`❌ CRITICAL: Configured Gemini model (${GEMINI_MODEL}) is outdated. Minimum required is ${requiredVersion}.`);
        process.exit(1);
    }
    
    console.log(`✅ Verified: Gemini Model is ${GEMINI_MODEL} (Version ${version} >= ${requiredVersion})`);
}

assertGeminiVersion();
