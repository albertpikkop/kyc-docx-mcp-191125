# 🚀 MexKYC "Analyst Workbench" — MVP Launch Plan

**Target Launch Date:** January 1st, 2026  
**Tech Lead:** Opus 4.5 Vision  
**Last Updated:** November 27, 2025

---

## 🎯 Final Verdict

We are building an **"Analyst Workbench"** — not a script, not a demo.

| FROM (Today) | TO (Launch Day) |
|--------------|-----------------|
| Deterministic (if/else) | Probabilistic (confidence scores) |
| Binary output (match/no-match) | Scored output + reasoning |
| Bug-fix-driven | Learning-driven |
| Demo that breaks on accents | Product that auto-approves 95% of cases |

**The system will say:**
> "I'm 94% confident ELOÍSA ARROYO MARTÍNEZ (Acta) and ARROYO MARTINEZ ELOISA (INE) are the same person. Matched by token-set after accent normalization."

**Not:**
> "match = true" (or crash on an accent)

---

## 🏗️ MVP Scope (What We Ship Jan 1st)

### Core Capability
**Mexican Persona Moral KYC — end-to-end**
- Acta Constitutiva (poderes, shareholders, registry)
- SAT Constancia (RFC, regime, fiscal address)
- INE/IFE or Passport + FM2 for legal reps
- Proof of Address (CFE/Telmex)
- Bank Statement (operational address)

### Intelligence Layer

| Component | What It Does |
|-----------|--------------|
| **Canonicalizer** | Accents, token-order, legal suffixes (SA de CV ≈ S.A. DE C.V.), nicknames (José ↔ Pepe) |
| **Entity Resolver** | Multi-layer matching → confidence score + reasoning |
| **Truth Resolution** | Field-level source-of-truth (SAT→RFC, Acta→poderes, Bank→operational address) |
| **Confidence Routing** | ≥95% auto-approve; 70–95% HITL queue; <70% reject with playbook |

### Product UX
- **Exception Queue** — side-by-side evidence, AI suggestion, Accept/Reject buttons
- **Evidence Panel** — clause highlights (poderes phrases, RFC, FME)
- **Report** — confidence scores, citations, XLSX/PDF export
- **Audit Trail** — who decided what, when, and why

---

## 📅 5-Week Sprint Roadmap (Nov 27 → Jan 1)

### Week 1–2: Canonicalization + Confidence (Dec 1–14)

**Deliverables:**

```typescript
// src/core/canonicalizer.ts

interface CanonicalResult {
  canonical: string;
  tokens: string[];
  confidence: number;
  matchType: 'exact' | 'normalized' | 'token' | 'phonetic';
  transformations: string[];
}

export function canonicalizeName(input: string): CanonicalResult;
export function canonicalizeEntity(input: string): CanonicalResult;
export function canonicalizeAddress(input: Address): CanonicalResult;

export function compareNames(a: string, b: string): MatchResult;
export function compareEntities(a: string, b: string): MatchResult;
```

**Handles (zero AI cost):**
- `ELOÍSA` → `ELOISA`
- `ARROYO MARTINEZ ELOISA` ↔ `ELOISA ARROYO MARTINEZ`
- `SA de CV` ↔ `S.A. DE C.V.` ↔ `SOCIEDAD ANONIMA`
- `JOSÉ` ↔ `PEPE`, `MA.` ↔ `MARIA`

**Tasks:**
- [ ] Build `src/core/canonicalizer.ts`
- [ ] Wire canonicalizer into all existing `namesMatch()` calls
- [ ] Add confidence and reasoning fields to every match result
- [ ] Surface confidence in report JSON + HTML

**Impact:** 80% of current bugs eliminated.

---

### Week 3: Entity Resolution Service (Dec 15–21)

**Deliverables:**

```typescript
// src/core/resolver.ts

interface MatchResult {
  isMatch: boolean;
  confidence: number;        // 0–100
  matchType: 'exact' | 'normalized' | 'token' | 'phonetic' | 'semantic';
  reasoning: string;
  evidence: { source: string; value: string }[];
}

async function resolveEntity(
  a: string, 
  b: string, 
  context: 'person' | 'entity' | 'address'
): Promise<MatchResult>;
```

**Multi-layer strategy:**
1. **Layer 1:** Exact match
2. **Layer 2:** Canonicalized match
3. **Layer 3:** Token-set / Jaro-Winkler
4. **Layer 4:** LLM fallback (GPT-4o-mini) for 70–95% cases

**Tasks:**
- [ ] Build `src/core/resolver.ts`
- [ ] Wire into: Acta↔INE, SAT↔Bank, POA↔Entity checks
- [ ] Add clause highlighting for poderes

**Impact:** Handles complex cases ("Whole Service" vs "Desarrollo Integral") with explainable reasoning.

---

### Week 4: HITL Exception Queue (Dec 22–28)

**Deliverables:**
- Exception Queue UI in wizard
  - Show flagged mismatches side-by-side
  - AI suggestion with confidence + reasoning
  - `[Accept]` / `[Reject]` / `[Request Doc]` buttons
- Persist analyst decisions to run's evidence graph
- Audit log — who overrode, when, optional comment
- Learning loop — carry forward decisions as priors

**Tasks:**
- [ ] Build Exception Queue component in `kyc-wizard.html`
- [ ] Create `decisions.json` persistence layer
- [ ] Wire decisions into report generation
- [ ] Add audit trail to evidence graph

**Impact:** Analysts only touch the 5% of messy cases. System remembers.

---

### Week 5: Polish + Demo Day (Dec 29 – Jan 1)

**Deliverables:**
- Golden set regression (50 cases including Alex Karam)
- Report polish — confidence badges, clause highlights, citations
- Wizard UX cleanup — progress indicators, mobile-friendly
- Documentation + API docs

**Demo Script:**
1. Import Alex Karam docs
2. Auto-approve 4/5 (>95% confidence)
3. Flag CFE mismatch with reasoning: *"'Whole Service' ≠ 'Desarrollo Integral'. Likely different entity. Confidence: 45%."*
4. Analyst clicks Reject → logged for audit
5. Generate final report with confidence + reasoning

---

## 📊 Success Metrics (Launch Day)

| Metric | Current | Target |
|--------|---------|--------|
| Name match accuracy | ~70% | **>95%** |
| Analyst touches per clean case | 100% | **<5%** |
| Time to clear exception | Manual | **<5 min** |
| Traceability | Partial | **100%** |
| Report generation | ~2 min | **<60 sec** |

---

## 💰 Revenue Model

| Tier | Price | Includes |
|------|-------|----------|
| **Starter** | $499/mo + $0.75/case | Wizard, 2K cases, auto-approve only |
| **Pro** | $1,999/mo + $0.45/case | + HITL queue, analyst notes, API, 99.9% SLA |
| **Enterprise** | Custom | + SSO, on-prem, audit exports, dedicated support |

**Unit Economics:**
- Cost per KYC: ~$0.05 (extraction) + $0.001 (semantic match if needed)
- Margin: **80–95%**

---

## ⛔ What We're NOT Building (Phase 2+)

| Feature | Why Defer |
|---------|-----------|
| Full Analyst Copilot chat | Cool but not blocking revenue |
| Embedding-based matching | LLM call is simpler + explainable |
| SAT/Bank API connectors | Nice-to-have |
| Multi-language beyond ES/EN | Mexico first |
| SOC2 certification | Need revenue first |

---

## 🛠️ Implementation Order (Starting Today)

### Day 1-2: Canonicalization Library
```
src/core/canonicalizer.ts
├── canonicalizeName()      — accents, order, aliases
├── canonicalizeEntity()    — legal suffixes  
├── canonicalizeAddress()   — Mexican address normalization
├── compareNames()          — returns MatchResult
└── compareEntities()       — returns MatchResult
```

### Day 3-4: Wire Into Existing Code
- Replace all `namesMatch()` calls
- Add confidence to validation results
- Update report to show confidence + reasoning

### Day 5-7: Entity Resolution Service
- Build resolver with 3-layer strategy
- Add LLM fallback for ambiguous cases
- Test with Alex Karam case

---

## 🎯 Vision Statement (For Investors / D&B)

> **MexKYC** is an AI-powered Analyst Workbench that auto-verifies 95% of Mexican corporate KYC cases and guides human analysts through the exceptions with explainable reasoning, full traceability, and regulatory-grade audit trails.
>
> **We don't replace analysts — we give them superpowers.**

---

## ✅ Ready to Build

**Week 1 starts now.**

First deliverable: `src/core/canonicalizer.ts`

