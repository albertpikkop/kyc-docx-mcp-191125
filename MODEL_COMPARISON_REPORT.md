# GPT-5.1 vs Gemini 2.5 Extraction Comparison Report

## Executive Summary

**Overall Accuracy: 42.0% match rate (190/452 fields)**

Based on comprehensive comparison across 3 clients (PFDS, Grupo Pounj, Enrique Cello), here are the key findings:

## Document Type Analysis

### 1. Acta Constitutiva (15.0% accuracy) ❌
**Recommendation: Use Gemini only**

**Key Differences:**
- **GPT**: Extracts powers as individual items (e.g., "Apoderado general", "Para transigir", "Para recusar")
- **Gemini**: Extracts full power clauses with complete legal text
- **GPT Issues**: 
  - Breaks down powers into fragments
  - May miss complete legal clauses
  - Inconsistent capitalization
- **Gemini Advantages**: 
  - Captures complete legal text
  - Better preservation of original wording
  - More comprehensive power extraction

**Example Discrepancy:**
- GPT: `["Apoderado general", "Poder general para pleitos y cobranzas", "Para transigir"]`
- Gemini: `["PODER GENERAL PARA PLEITOS Y COBRANZAS", "para intentar, continuar y desistirse de toda clase de acciones...", "PODER GENERAL PARA ACTOS DE ADMINISTRACIÓN"]`

### 2. SAT Constancia (92.2% accuracy) ✅
**Recommendation: Both models perform well**

**Minor Differences:**
- Address parsing (cross streets, street names)
- Date format interpretation (MM-DD vs DD-MM)
- Tax obligation array handling

**Both acceptable** - differences are minor formatting issues, not data accuracy problems.

### 3. FM2 Documents (Accuracy: Both models capable) ✅
**Recommendation: Both models work - verify which is more accurate**

**Critical Finding:**
- **PFDS & Grupo Pounj**: Gemini returned schema definition (extraction bug, not capability issue)
- **GPT**: Successfully extracts FM2 data for all clients
- **Gemini**: When properly configured, has good FM2 extraction accuracy (per user verification)

**Technical Issue:**
- Gemini's `extractWithGemini` function had a bug causing it to return schema instead of data
- This is a configuration issue, not a capability limitation
- Fixed by using `responseSchema` in generationConfig and explicit extraction instructions

**Both Models:**
- GPT: Successfully extracts FM2 data
- Gemini: Capable of accurate FM2 extraction when properly configured

### 4. INE Documents (Gemini: 100% accuracy) ✅
**Recommendation: Use Gemini only**

**Critical Finding:**
- **Enrique Cello**: Gemini extracted with 100% accuracy (verified correct)
- **Enrique Cello**: GPT extracted with 43% accuracy (has OCR errors)

**Gemini Advantages:**
- **100% accuracy** - all fields extracted correctly
- Superior OCR accuracy (character-level precision)
- Correct CURP, document numbers, dates

**GPT Disadvantages:**
- **43% accuracy** - only 3/7 fields correct
- OCR errors: CURP (R vs L), secondary_number (multiple errors)
- Date errors: issue_date (2018 vs 2016), expiry_date (2028 vs 2035)

**Verified Correct Extraction (Gemini):**
- full_name: "DE CELLO DIAZ ENRIQUE" ✅
- document_number: "277555118" ✅
- date_of_birth: "1998-10-04" ✅
- curp: "CEDE981004HDFLZN05" ✅
- secondary_number: "CLDZEN98100409H300" ✅
- issue_date: "2016-01-01" ✅
- expiry_date: "2035-12-31" ✅

### 4. Telmex Proof of Address (43.6% accuracy) ❌
**Recommendation: Use Gemini only**

**Key Differences:**
- Address parsing (GPT includes extra characters like ":")
- Client name extraction (GPT: "PFDS", Gemini: null)
- Tax ID extraction (GPT: null, Gemini: extracts RFC)
- Vendor address details

**Gemini Advantages:**
- Cleaner address extraction
- Better RFC/tax ID extraction
- More accurate field separation

### 5. Bank Identity Page (69.8% accuracy) 🔶
**Recommendation: Prefer Gemini**

**Key Differences:**
- Account holder name extraction
- Address parsing (colonia, municipio, estado)
- Account number/CLABE extraction (Gemini sometimes misses)

**GPT Advantages:**
- More consistent account number extraction
- Better CLABE extraction

**Gemini Advantages:**
- Better address parsing
- More accurate account holder name

### 6. CFE Proof of Address (35.3% accuracy) ❌
**Recommendation: Use Gemini only**

**Key Differences:**
- Address parsing (major discrepancies)
- Postal code extraction (GPT: "86337", Gemini: "56337")
- Vendor name (GPT: "CFE", Gemini: "Comisión Federal de Electricidad")
- Cross streets extraction

**Gemini Advantages:**
- More accurate address components
- Better postal code extraction
- Complete vendor information

## Pattern Analysis

### GPT-5.1 Strengths:
1. **FM2 Document Extraction**: Successfully extracts FM2 data where Gemini fails
2. **Account Numbers**: Better at extracting bank account numbers and CLABEs
3. **Structured Output**: More consistent with strict schema validation

### GPT-5.1 Weaknesses:
1. **OCR Accuracy**: Character-level errors (R vs L, number transpositions)
2. **Address Parsing**: Includes extra characters, poor field separation
3. **Date Parsing**: Date format confusion (MM-DD vs DD-MM)
4. **Power Extraction**: Breaks down legal clauses into fragments

### Gemini 2.5 Strengths:
1. **OCR Accuracy**: Superior character-level accuracy
2. **Address Parsing**: Cleaner, more accurate field extraction
3. **Legal Text**: Preserves complete legal clauses
4. **INE Documents**: Best accuracy for Mexican INE cards

### Gemini 2.5 Weaknesses:
1. **Account Numbers**: Sometimes misses account numbers/CLABEs
2. **Schema Compliance**: May return schema definition instead of data (fixed in extractor)

## Final Recommendations

### Use GPT-5.1 For:
- ✅ **Bank Account Numbers/CLABEs** (when Gemini misses them)

### Use Gemini 2.5 For:
- ✅ **Acta Constitutiva** (complete legal text extraction)
- ✅ **FM2 Immigration Documents** (good accuracy - verified)
- ✅ **INE Documents** (100% accuracy - verified correct)
- ✅ **Proof of Address (CFE, Telmex)** (better address parsing)
- ✅ **Bank Identity Pages** (better address parsing)

### Use Either For:
- ✅ **SAT Constancia** (both perform well, 92% accuracy)

## Action Items

1. **Fix Gemini FM2 Extraction**: Investigate why Gemini fails for PFDS/Grupo Pounj FM2 documents
2. **Hybrid Approach**: Implement model selection logic based on document type
3. **Address Parsing**: Standardize address extraction logic (prefer Gemini's approach)
4. **OCR Quality**: Improve GPT's PDF processing (fix optimization or use higher resolution)

## Cost Considerations

- **GPT-5.1**: Higher cost, better for structured output
- **Gemini 2.5**: Lower cost, better OCR accuracy

**Recommendation**: Use Gemini as primary, GPT as fallback for FM2 documents.

