# RealityDB — Data Generation Guide
## Comprehensive Pack Development Protocols

**Version:** 2.0 — May 2026
**Supersedes:** PACK-AUTHORING-CHECKLIST.md (which remains valid as a quick reference)
**Save to:** C:\Users\HP\Documents\realitydb-internal\01-cli-engine\DATA-GENERATION-GUIDE.md
**Engine version:** CLI v2.38.0, engine commit ada0a78

---

## OVERVIEW

This guide covers the complete lifecycle of a RealityDB pack — from
domain research to production deployment. Follow it in order for new
packs. Use the checklist in Section 10 as a pre-publish gate.

The quality standard is non-negotiable: **97/100 SQR effective score,
HIGH confidence, research-backed distributions.** Every pack that ships
under the RealityDB brand must meet this standard.

---

## PART 1 — BEFORE YOU WRITE A SINGLE LINE OF JSON

### 1.1 Domain Research (mandatory for every new pack)

**The fundamental rule:** Every non-uniform distribution must have a
citation. A healthcare pack that distributes blood types equally (25%
each) is worse than no pack at all — it teaches wrong intuitions.

**Research sources by domain:**

| Domain | Primary sources |
|---|---|
| Healthcare | CDC National Center for Health Statistics, WHO, PubMed epidemiology |
| FinTech | Federal Reserve payments data, CFPB reports, BIS statistics |
| E-Commerce | Shopify Commerce Report, Digital Commerce 360, NRF data |
| SaaS | OpenView SaaS Benchmarks, Bessemer Cloud Index, Stripe Atlas |
| Logistics | Bureau of Transportation Statistics, FreightWaves, CSCMP |
| Telecom | FCC reports, GSMA Intelligence, ITU statistics |
| African Markets | CBK (Kenya), GSMA Mobile Money, World Bank FINDEX |
| Education | NCES (US), UNESCO, state education departments |
| Oncology | SEER database (NCI), CTCAE grading tables, RECIST criteria |

**What to research before designing a pack:**

1. **Status distributions** — what % of records are in each state?
   Example: Active SaaS subscriptions are ~65% of all-time signups;
   churned are ~28%; paused ~7% (OpenView SaaS Benchmarks 2024)

2. **Amount distributions** — what is the mean, stddev, min, max?
   Example: B2B SaaS ACV follows lognormal distribution with median
   ~$12,000, mean ~$28,000 (long right tail from enterprise deals)

3. **Cardinality ratios** — how many child records per parent?
   Example: E-commerce orders average 3.2 items per order (NRF 2024)

4. **Temporal patterns** — what are realistic time gaps between events?
   Example: Healthcare: average 14 days between appointment booking
   and appointment date; 3-6 months between primary care visits

5. **Domain-specific constraints** — what combinations are impossible?
   Example: A discharged patient cannot have future appointments
   that were created before the admission date

**Document your research in `_meta`:**

```json
"_meta": {
  "domain": "Healthcare",
  "version": "3.0",
  "citations": [
    {
      "field": "patients.blood_type",
      "distribution": "O+ 38%, A+ 30%, B+ 9%, AB+ 3%, O- 7%, A- 6%, B- 2%, AB- 1%",
      "source": "Stanford Blood Center / American Red Cross, 2024",
      "url": "https://www.redcrossblood.org/donate-blood/blood-types.html"
    },
    {
      "field": "appointments.status",
      "distribution": "completed 72%, no_show 12%, cancelled 11%, rescheduled 5%",
      "source": "MGMA Physician Practice Management Survey, 2023"
    }
  ]
}
```

### 1.2 Schema Design

Before writing column definitions, design the schema on paper:

1. **Identify the root table** — the entity everything else belongs to
   (patients, customers, subscribers, agents)

2. **Draw the FK tree** — which tables are children of which?
   Draw this literally. Circular dependencies are forbidden.

3. **Identify cardinality at each edge** — how many child rows per parent?
   Write the mean and range for every relationship.

4. **Identify temporal dependencies** — which timestamps must be ordered?
   Document: created_at < submitted_at < approved_at < completed_at

5. **Identify domain-specific constraints** — what combinations are
   domain-impossible? These become `dependsOn` rules or post-generation
   UPDATE statements.

**Example FK tree for Healthcare:**
```
patients (root)
├── appointments (N per patient, mean 6.2/year)
│   ├── diagnoses (N per appointment, mean 1.8)
│   └── prescriptions (N per appointment, mean 2.1)
├── lab_orders (N per patient, mean 4.1/year)
│   └── lab_results (1 per lab_order)
└── insurance_claims (N per patient, mean 8.3/year)
    └── claim_payments (1 per claim)
```

---

## PART 2 — PACK JSON STRUCTURE

### 2.1 Top-Level Shape

```json
{
  "name": "Healthcare System",
  "version": "3.0",
  "description": "Patient records, clinical encounters, prescriptions, and billing",
  "_meta": {
    "domain": "Healthcare",
    "sqr_score": "100/100",
    "confidence": "HIGH",
    "root_table": "patients",
    "citations": []
  },
  "tables": { ... },
  "relationships": [ ... ]
}
```

**Rules:**
- `name` — human-readable, matches the sandbox display name
- `version` — increment on every significant change
- `_meta` — required for marketplace packs; optional for internal packs
- `tables` — required, never empty
- `relationships` — required if any child tables exist
- ❌ NEVER use `count_factor` — engine ignores it silently

### 2.2 Table Definition Structure

```json
"patients": {
  "primaryKey": "id",
  "match": "patient",
  "foreignKeys": [],
  "columns": [
    { "name": "id", "type": "uuid" },
    { "name": "full_name", "type": "string", "strategy": "full_name" },
    { "name": "email", "type": "string", "strategy": "email" },
    { "name": "phone", "type": "string", "strategy": "phone" },
    { "name": "date_of_birth", "type": "past_date", "options": { "minYear": 1940, "maxYear": 2005 } },
    {
      "name": "blood_type",
      "type": "string",
      "strategy": "enum",
      "values": [
        { "value": "O+",  "probability": 0.38 },
        { "value": "A+",  "probability": 0.30 },
        { "value": "B+",  "probability": 0.09 },
        { "value": "AB+", "probability": 0.03 },
        { "value": "O-",  "probability": 0.07 },
        { "value": "A-",  "probability": 0.06 },
        { "value": "B-",  "probability": 0.02 },
        { "value": "AB-", "probability": 0.01 }
      ]
    },
    {
      "name": "status",
      "type": "string",
      "strategy": "enum",
      "values": [
        { "value": "active",    "probability": 0.75 },
        { "value": "inactive",  "probability": 0.15 },
        { "value": "deceased",  "probability": 0.06 },
        { "value": "transferred","probability": 0.04 }
      ]
    },
    { "name": "created_at", "type": "past_date" }
  ]
}
```

**Required per table:**
- `primaryKey` — name of the PK column
- `foreignKeys` — array (empty for root tables)
- `columns` — array of column definitions
- `match` — semantic label for the assessor (optional but recommended)

### 2.3 Column Type Reference

| Type | When to use | Example |
|---|---|---|
| `uuid` | Primary keys, UUID foreign keys | `{ "name": "id", "type": "uuid" }` |
| `integer` | Sequential IDs, counts, quantities | `{ "name": "quantity", "type": "integer", "min": 1, "max": 50 }` |
| `float` | Amounts, rates, measurements | See Section 2.5 |
| `string` | Text with strategy | See Section 2.4 |
| `past_date` | Historical timestamps | `{ "name": "created_at", "type": "past_date" }` |
| `future_date` | Expiry, scheduled dates | `{ "name": "expires_at", "type": "future_date" }` |
| `boolean` | ❌ FORBIDDEN — use enum instead | See Section 2.6 |

### 2.4 String Strategy Reference

| Strategy | Generates | Use for |
|---|---|---|
| `full_name` | "Alexandra Okonkwo" | Person names |
| `email` | "alex.okonkwo@gmail.com" | Email addresses |
| `phone` | "+1 (555) 234-5678" | Phone numbers |
| `company_name` | "Meridian Solutions LLC" | Company/org names |
| `street_address` | "1234 Oak Street" | Addresses |
| `city` | "Charlotte" | Cities |
| `state` | "NC" | US states |
| `zip_code` | "28201" | ZIP codes |
| `ip_address` | "192.168.1.45" | IP addresses |
| `uuid` | UUID string | UUID text fields |
| `enum` | One of defined values | Categorical columns |
| `random_string` | Random alphanumeric | Tokens, references |

### 2.5 Float Distribution Reference

```json
{ "name": "amount", "type": "float", "distribution": {
  "type": "normal", "mean": 149.99, "stddev": 80.0, "min": 0.99, "max": 999.99
}}

{ "name": "session_minutes", "type": "float", "distribution": {
  "type": "lognormal", "mean": 2.5, "stddev": 0.8, "min": 1, "max": 480
}}

{ "name": "failure_rate", "type": "float", "distribution": {
  "type": "weibull", "k": 1.5, "lambda": 0.02, "min": 0, "max": 1
}}

{ "name": "load_factor", "type": "float", "distribution": {
  "type": "uniform", "min": 0.3, "max": 1.2
}}

{ "name": "wait_time", "type": "float", "distribution": {
  "type": "exponential", "rate": 0.1, "min": 0
}}
```

**When to use which:**
- `normal` — symmetric around a mean (heights, prices, scores)
- `lognormal` — right-skewed (income, session duration, company size)
- `weibull` — failure/survival modeling (equipment lifetime, churn)
- `uniform` — truly random within a range (rare in real data)
- `exponential` — time between events (support tickets, transactions)

### 2.6 The Boolean Prohibition

**Never use:** `{ "name": "is_active", "type": "boolean" }`

**Always use:**
```json
{
  "name": "is_active",
  "type": "string",
  "strategy": "enum",
  "values": [
    { "value": "true",  "probability": 0.82 },
    { "value": "false", "probability": 0.18 }
  ]
}
```

Why: the boolean strategy generates exactly 50/50 true/false.
Real boolean fields are almost never 50/50. The enum strategy
lets you set the real-world ratio.

---

## PART 3 — FOREIGN KEYS AND CARDINALITY

### 3.1 Foreign Key Declaration

```json
"appointments": {
  "primaryKey": "id",
  "foreignKeys": [
    {
      "column": "patient_id",
      "references": { "table": "patients", "column": "id" }
    }
  ],
  "columns": [ ... ]
}
```

**Critical rule — FK ordering:**
When a child has multiple FKs, the FIRST FK drives row-count sizing.
List the semantically-owning parent first.

```json
"prescriptions": {
  "foreignKeys": [
    { "column": "appointment_id", "references": { "table": "appointments", "column": "id" } },
    { "column": "medication_id",  "references": { "table": "medications",  "column": "id" } }
  ]
}
```

In this example, prescriptions belong to appointments (first FK).
The number of prescriptions is calculated as: mean × number_of_appointments.
The medication_id is a reference lookup only, does not affect row count.

### 3.2 Cardinality Declarations

```json
"relationships": [
  {
    "targetTable": "appointments",
    "cardinality": {
      "strategy": "poisson",
      "mean": 6.2,
      "min": 1,
      "max": 24
    }
  },
  {
    "targetTable": "diagnoses",
    "cardinality": {
      "strategy": "poisson",
      "mean": 1.8,
      "min": 1,
      "max": 8
    }
  },
  {
    "targetTable": "lab_results",
    "cardinality": {
      "strategy": "fixed",
      "mean": 1.0,
      "min": 1,
      "max": 1
    }
  }
]
```

**Strategy selection:**
- `poisson` — variable count with realistic variance (most relationships)
- `fixed` — always exactly mean (1:1 relationships like lab_order → lab_result)

**Setting mean values:**
Mean is children-per-parent-row. Research this from domain data.

| Relationship | Typical mean | Source |
|---|---|---|
| Patient → annual appointments | 3.8 | MGMA 2023 |
| Order → order items | 3.2 | NRF 2024 |
| User → subscriptions (lifetime) | 1.6 | OpenView 2024 |
| Invoice → payments | 1.1 | (most invoices paid once) |
| Account → transactions/month | 12.4 | Federal Reserve 2024 |

---

## PART 4 — TEMPORAL LOGIC

### 4.1 The Temporal Ordering Problem

The most common data quality failure: timestamps that defy causality.
`delivered_at < ordered_at` makes no sense in the real world.

**The Structure pillar of SQR penalizes every temporal violation.**
Getting Structure to 100/100 requires zero violations.

### 4.2 Temporal Dependency Patterns

**Pattern A — Simple lifecycle (append to SQL file):**
```sql
-- After INSERTs: fix any created_at > completed_at violations
UPDATE orders 
SET completed_at = created_at + 
  (EXTRACT(EPOCH FROM (completed_at - created_at)) * RANDOM() * 0.5 + 
   EXTRACT(EPOCH FROM (completed_at - created_at)) * 0.5) * INTERVAL '1 second'
WHERE completed_at < created_at;
```

**Pattern B — flatten.mjs approach (Claude Code's method):**
1. Append UPDATE statements to SQL file
2. Load into PGlite (executes INSERTs + UPDATEs)
3. Dump fresh INSERT VALUES per table
4. Result: clean INSERTs with no UPDATE statements

This is required because `examine assess` only parses INSERT rows —
it ignores UPDATE statements. Flattening makes the fixed data visible
to the assessor.

**Pattern C — Pack-level dependsOn (future feature, not yet implemented):**
When the engine supports it: declare temporal dependencies in the pack
so they are respected at generation time without post-processing.

### 4.3 Common Temporal Pairs to Check

Always verify these pairs are in the correct order:

```
created_at        < submitted_at
submitted_at      < approved_at
approved_at       < started_at
started_at        < completed_at
completed_at      < closed_at
ordered_at        < shipped_at
shipped_at        < delivered_at
admitted_at       < discharged_at
prescribed_at     < dispensed_at
invoice_date      < due_date
due_date          > today (for future invoices)
```

---

## PART 5 — DISTRIBUTION QUALITY STANDARDS

### 5.1 The 80% Rule

No single enum value may represent more than 80% of a column's rows.
Distributions above 80% are flagged as "skewed" by the assessor and
reduce the Fidelity score.

**Exception:** Domain-accurate distributions that genuinely exceed 80%
are acceptable with citation. Example: M-Pesa transaction success rate
is 88-92% in actual CBK data — this passes with citation.

### 5.2 Target Distributions by Column Type

**Status columns (most tables):**
- At least 3 distinct values
- No value > 80% without domain citation
- Typical healthy distribution: active 70-75%, inactive 15-20%, other 5-10%

**Amount columns:**
- Must have variance (stddev > 0)
- Max/min ratio > 2 (not all the same amount)
- Use normal or lognormal distribution
- Never uniform unless domain requires it

**Date columns:**
- Spread across at least 6 months
- Prefer 12-24 month historical range
- Never all the same date (NOW() without offset)

### 5.3 Research-Backed Distribution Examples

**Blood types (US population — Red Cross 2024):**
```json
"values": [
  { "value": "O+",  "probability": 0.38 },
  { "value": "A+",  "probability": 0.30 },
  { "value": "B+",  "probability": 0.09 },
  { "value": "AB+", "probability": 0.03 },
  { "value": "O-",  "probability": 0.07 },
  { "value": "A-",  "probability": 0.06 },
  { "value": "B-",  "probability": 0.02 },
  { "value": "AB-", "probability": 0.01 }
]
```

**SaaS subscription plans (OpenView 2024):**
```json
"values": [
  { "value": "free",       "probability": 0.45 },
  { "value": "starter",    "probability": 0.28 },
  { "value": "pro",        "probability": 0.19 },
  { "value": "enterprise", "probability": 0.08 }
]
```

**E-commerce order status (NRF / Shopify 2024):**
```json
"values": [
  { "value": "completed",  "probability": 0.68 },
  { "value": "processing", "probability": 0.12 },
  { "value": "shipped",    "probability": 0.10 },
  { "value": "cancelled",  "probability": 0.07 },
  { "value": "refunded",   "probability": 0.03 }
]
```

**M-Pesa transaction status (CBK Kenya Annual Report 2023):**
```json
"values": [
  { "value": "completed", "probability": 0.82 },
  { "value": "failed",    "probability": 0.08 },
  { "value": "pending",   "probability": 0.05 },
  { "value": "reversed",  "probability": 0.03 },
  { "value": "expired",   "probability": 0.02 }
]
```

**Healthcare appointment status (MGMA 2023):**
```json
"values": [
  { "value": "completed",   "probability": 0.72 },
  { "value": "no_show",     "probability": 0.12 },
  { "value": "cancelled",   "probability": 0.11 },
  { "value": "rescheduled", "probability": 0.05 }
]
```

---

## PART 6 — THE GENERATION PIPELINE

### 6.1 Standard Pipeline (new pack from scratch)

```
STEP 1: Research (Section 1.1)
  └── Document citations before writing any JSON

STEP 2: Schema design (Section 1.2)
  └── Draw FK tree, identify cardinality, identify temporal deps

STEP 3: Write pack JSON
  ├── Top-level structure
  ├── All tables with columns and strategies
  └── Relationships block with cardinality

STEP 4: Validate pack structure
  realitydb pack:validate --pack mypack.json
  Target: 0 errors, 0 warnings

STEP 5: Generate small scale
  realitydb run --pack mypack.json --rows 10000 --format sql -o test.sql

STEP 6: Assess without pack flag (heuristic mode)
  realitydb examine assess test.sql
  Target: ≥ 90/100

STEP 7: Assess with pack flag (pack-aware mode)
  realitydb examine assess test.sql --pack mypack.json
  Target: ≥ 95/100, cardinality score 100

STEP 8: Fix issues identified
  ├── Distribution diversity: add/adjust weights
  ├── Correlation stability: break artificial patterns
  ├── Temporal logic: add UPDATE fixes + flatten
  └── Cardinality: adjust mean values

STEP 9: Repeat steps 5-8 until score ≥ 97/100

STEP 10: Generate at production scale
  realitydb run --pack mypack.json --rows [target] --format sql -o prod.sql

STEP 11: Final assessment
  realitydb examine assess prod.sql --pack mypack.json
  Must show ≥ 97/100 HIGH confidence

STEP 12: Smoke test
  cd C:\Users\HP\Documents\databox
  node apps\cli\smoke-test.cjs
  Must show: ✅ Passed: 158  ❌ Failed: 0

STEP 13: Commit
  git add mypack.json
  git commit -m "feat(pack): [domain] v[version] — [score]/100 HIGH confidence"
  git push
```

### 6.2 Improvement Pipeline (existing pack needs fixes)

```
STEP 1: Assess current state
  realitydb examine assess existing.sql --json

STEP 2: Identify failing metrics
  ├── Fidelity < 95? → Check distribution diversity + correlation stability
  ├── Structure < 100? → Check temporal logic violations
  └── Cardinality off? → Adjust relationships block mean values

STEP 3: Fix in this order
  1. Pack JSON fixes (enum weights, float distributions)
  2. Temporal fixes (UPDATE statements + flatten)
  3. Cardinality adjustments

STEP 4: Generate fresh data
  realitydb run --pack improved.json --rows [target] --format sql -o new.sql

STEP 5: Assess and iterate
  realitydb examine assess new.sql --pack improved.json

STEP 6: Deploy when ≥ 97/100
```

### 6.3 Sandbox Template Improvement Pipeline

For existing sandbox templates without pack JSON files:

```
STEP 1: Audit existing SQL file
  node .audit-tmp/audit-runner.mjs [template-id]

STEP 2: Identify issues from audit report
  ├── Status distribution skewed?
  ├── Dates all NOW()?
  ├── Amounts uniform?

STEP 3: Apply targeted SQL fixes
  ├── Status: UPDATE [table] SET status = 'inactive' WHERE id % 8 = 0;
  ├── Dates: UPDATE [table] SET created_at = NOW() - INTERVAL '1 day' * (RANDOM() * 365 * 2);
  └── Amounts: UPDATE [table] SET amount = amount * (0.5 + RANDOM());

STEP 4: Flatten (critical — assessor ignores UPDATE statements)
  node .audit-tmp/flatten.mjs input.sql output.sql

STEP 5: Assess flattened file
  realitydb examine assess output.sql

STEP 6: Deploy if ≥ 97/100
```

---

## PART 7 — ROW COUNT TARGETS

### 7.1 Standard Targets by Template Tier

| Tier | Tables | Root rows | Total rows | Why |
|---|---|---|---|---|
| STARTER | 4-5 | 200-500 | 1,000-5,000 | Beginner SQL practice |
| STANDARD | 6-13 | 1,000-5,000 | 10,000-50,000 | Full SQL challenges |
| GOVERNMENT | 12-16 | 2,000-5,000 | 30,000-60,000 | Complex analytics |
| AFRICAN MARKET | 6-7 | 1,000-3,000 | 15,000-25,000 | Domain-specific practice |
| MARKETPLACE | 8-24 | 2,000-10,000 | 25,000-100,000 | Production simulation |

### 7.2 Why Row Counts Matter

- **Too few:** Window function challenges return trivial results
- **Too many:** Browser-side PGlite loading becomes slow (> 15MB SQL)
- **Target:** 50K rows across 10 tables loads in < 3 seconds in PGlite

**File size targets:**
- Sandbox templates: 0.1MB - 15MB SQL file
- Marketplace packs (generated on demand): no limit

---

## PART 8 — DOMAIN-SPECIFIC PROTOCOLS

### 8.1 Healthcare Packs

**Required tables minimum:** patients, appointments, diagnoses,
prescriptions, medications, lab_orders, lab_results

**HIPAA-aware design:**
- No real patient names from real data sources
- Use `full_name` strategy (generates plausible but fictional names)
- No real SSNs, DOBs tied to real people
- All data synthetic — use `_meta.hipaa_safe: true`

**Clinical accuracy requirements:**
- ICD-10 codes must be valid (use real code list subset)
- Drug names must be real medications (not fictional)
- Dosages must be within clinical ranges
- Lab values must be within physiologically possible ranges

**Key distributions (NCHS 2023):**
- Patient age distribution: right-skewed, median ~47, stddev ~18
- Visit frequency: Poisson(mean=3.8) per patient per year
- No-show rate: 12-15% (varies by specialty)
- Readmission within 30 days: 14-18% for inpatient

### 8.2 FinTech / Banking Packs

**Required tables minimum:** accounts, customers, transactions,
merchants, cards

**Regulatory considerations:**
- No real account numbers
- Transaction amounts: lognormal distribution (most small, rare large)
- Fraud rate: 0.1-0.3% of transactions (Federal Reserve 2023)
- Use realistic reference numbers (not sequential integers)

**Key distributions:**
- Transaction amount: lognormal(mean=2.5, stddev=1.2) → median ~$12, mean ~$28
- Daily transaction count per account: Poisson(mean=2.8)
- NSF/overdraft rate: ~4% of accounts per month

### 8.3 African Market Packs (M-Pesa, SACCO)

**M-Pesa specific:**
- Phone numbers MUST follow Kenyan format: +254 7XX XXX XXX
- Transaction amounts in KES: typical range 50-50,000
- Agent float balances: KES 10,000-500,000
- Transaction types weighted by CBK data (send_money 45%, pay_bill 30%,
  buy_airtime 15%, withdraw 8%, other 2%)

**SACCO specific:**
- Member contributions in KES: 500-5,000/month
- Loan amounts: KES 5,000-500,000 (based on share capital × multiplier)
- Interest rates: 12-18% per annum (Kenyan SACCO regulatory range)
- Loan-to-share ratio: maximum 3:1 (regulatory requirement)
- Meeting types: monthly (70%), AGM (8%), special (15%), emergency (7%)

**Kenya CBC Education specific:**
- Grade levels: 1-9 ONLY (not 1-12 — CBC structure differs from 8-4-4)
- Assessment scale: EE (Exceeds Expectation), ME, AE, BE — NOT percentages
- Learning areas: Literacy, Numeracy, Hygiene, Environmental, Creative Arts,
  Movement, Religious Education (PP1-PP2); expand for grades 1-9

### 8.4 E-Commerce Packs

**Required tables minimum:** customers, products, orders, order_items,
payments, reviews, categories

**Key distributions (Shopify Commerce Report 2024):**
- Cart abandonment rate: 69-75% (include abandoned carts in orders table)
- Items per order: lognormal(mean=1.1, stddev=0.4) → 3.2 mean items
- Repeat purchase rate: ~32% of customers make second purchase within 90 days
- Return rate: ~8-10% of completed orders
- Review rate: ~15% of orders generate a review

### 8.5 SaaS Packs

**Required tables minimum:** users, organizations, subscriptions, plans,
usage_events, invoices, payments, features

**Key distributions (OpenView SaaS Benchmarks 2024):**
- Free-to-paid conversion: 2-5% of free users
- Monthly churn rate: 2-8% (varies by plan)
- Annual plan adoption: ~35% of paid customers
- Net Revenue Retention: 100-130% for healthy SaaS
- Support ticket rate: ~0.3 tickets per active user per month

---

## PART 9 — COMMON MISTAKES AND FIXES

### M1: All statuses equal (uniform distribution)
**Symptom:** Distribution diversity score < 90
**Fix:** Add research-backed probability weights to enum values

### M2: Boolean strategy used
**Symptom:** pack:validate warning about boolean type
**Fix:** Replace with enum strategy, set realistic true/false ratio

### M3: Temporal violations (X happened before Y)
**Symptom:** Structure pillar < 100, temporal logic score < 100
**Fix:** Add UPDATE statements to enforce ordering, then flatten

### M4: All dates the same (NOW() without offset)
**Symptom:** Date spread < 3 months, distribution diversity low
**Fix:** Use `NOW() - INTERVAL '1 day' * ((id * prime) % span)` patterns
        with 18-24 month spans for historical data

### M5: FK ordering wrong (wrong table drives cardinality)
**Symptom:** Cardinality ratios way off from expected
**Fix:** Reorder foreignKeys so semantically-owning parent is FIRST
        Engine limitation: only first FK drives row-count sizing

### M6: Enum probabilities don't sum to 1.0
**Symptom:** pack:validate error
**Fix:** Adjust probabilities — add a rounding catch-all value

### M7: Correlation stability failures
**Symptom:** Fidelity score 79-85, correlation stability warned
**Fix:** Check for perfectly sequential IDs, uniform amounts, or amount
        columns that are exact multiples of each other. Add noise.
        Note: domain-realistic correlations (distance ↔ travel time)
        are acceptable — accept and document.

### M8: count_factor used (legacy field)
**Symptom:** Engine silently ignores it, rows not as expected
**Fix:** Remove count_factor, use relationships block with cardinality

### M9: Child table row count far from expected
**Symptom:** assess --pack shows cardinality >50% off declared
**Fix:** Mean in relationships is children-per-FIRST-FK-parent.
        If patients avg 6.2 appointments: mean = 6.2 in appointments relationship.
        Verify by: run 10K, count appointments/patients ratio.

### M10: Privacy pillar penalizing sandbox data
**Symptom:** Phone, email columns flagged as PII, score drops
**Fix:** For sandbox templates — use effective score (Fidelity + Structure)/2.
        Privacy pillar is intentionally ignored for sandbox datasets
        where realistic PII is the point.
        For compliance datasets — use masked or synthetic variants.

---

## PART 10 — PRE-PUBLISH CHECKLIST

Run through this before every pack publication.

### Pack JSON checks
- [ ] Top-level: name, version, description, _meta, tables, relationships present
- [ ] No `count_factor` field anywhere
- [ ] All enum probabilities sum to 1.0 (check each enum column)
- [ ] No boolean type used (all booleans are enum with true/false values)
- [ ] FK ordering: semantically-owning parent is first in each foreignKeys array
- [ ] `primaryKey` declared on every table
- [ ] `match` field present on root table at minimum
- [ ] All float distributions have valid parameters (no NaN, k>0 for Weibull)
- [ ] `_meta.citations` populated for all non-uniform distributions

### Generation checks
- [ ] `realitydb pack:validate --pack [pack]` → 0 errors, 0 warnings
- [ ] Generates at 10K rows without error
- [ ] Generates at 100K rows without error
- [ ] Smoke test: 158/158 passing

### Quality checks
- [ ] `examine assess test.sql` → overall score ≥ 90
- [ ] `examine assess test.sql --pack [pack]` → overall score ≥ 95
- [ ] Cardinality score = 100 (all ratios within ±20% of declared)
- [ ] Structure score = 100 (zero temporal violations)
- [ ] Distribution diversity = 100 (no skewed columns)
- [ ] Final production-scale assess → ≥ 97/100 HIGH confidence

### Domain accuracy checks
- [ ] Status distributions match domain research (cited in _meta)
- [ ] Amount distributions match domain research (cited in _meta)
- [ ] Cardinality ratios match domain research (cited in _meta)
- [ ] No domain-impossible value combinations
- [ ] Temporal ordering matches real-world event sequences
- [ ] Domain-specific identifiers follow real formats
  (phone numbers, account numbers, drug codes, ICD codes)

### Final gates
- [ ] Committed to pack repo with descriptive message
- [ ] SYSTEM-KNOWLEDGE.md updated with new pack and score
- [ ] If sandbox template: deployed to sandbox.realitydb.dev
- [ ] If marketplace pack: listed in Data Store with score badge

---

## PART 11 — BUILD CONVENTIONS (WINDOWS POWERSHELL)

These apply to all pack development and engine work.

### File writing
Always write BOM-free UTF-8:
```powershell
[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))
```

### Path handling
- Always use absolute paths
- Use `-LiteralPath` for paths with brackets or special characters
- Never `cd` then use relative paths in scripts

### Engine junction (CRITICAL)
Never run `pnpm add` or `pnpm remove` in `apps/cli/`.
If broken, restore with:
```powershell
New-Item -ItemType Junction `
  -Path C:\Users\HP\Documents\databox\node_modules\@realitydb\engine `
  -Target C:\Users\HP\Documents\databox\packages\engine `
  -Force
```

### Backup before editing engine files
```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$bak = "C:\Users\HP\Documents\realitydb-internal\engine-backups"
Copy-Item -LiteralPath $source -Destination "$bak\$filename.$ts" -Force
```

### Rebuild order for engine changes
schema → generators → templates → core → cli

For CLI-only changes (assess.ts, run.ts): `pnpm --filter cli build` only

---

## PART 12 — KNOWN ENGINE LIMITATIONS

| ID | Limitation | Workaround |
|---|---|---|
| M5 | Multi-FK children sized by first FK only | Order FKs intentionally — semantically-owning parent FIRST |
| H7 | `examine assess` fails on output >512 MB | Assess at smaller scale (1M and below) |
| CSV | parseCsv hardcodes fks: [] — cardinality scoring broken | Use SQL format for all assessment workflows |
| JSON | No JSON parser — only SQL and CSV input | Generate as SQL for assessment |
| M8 | Smoke test fintech sometimes flakes at quality 95 | Re-run; not a real regression |
| BOOL | Boolean strategy = always 50/50 | Use enum with true/false values + research-backed weights |
| UPDATE | examine assess ignores UPDATE statements | Use flatten approach: load PGlite → apply UPDATEs → dump INSERTs |
| BATCH | Sandbox templates have no pack JSON | Use in-place SQL patches + flatten for improvements |

---

## PART 13 — REFERENCE: AUTHORITATIVE EXAMPLES

### Highest-quality pack JSON reference
`github.com/emkwambe/grid-silent-cascade/packs/grid_silent_cascade.json`
- 8 tables, 7 cardinality declarations
- Rare-event ratios (4% ferroresonance)
- Weibull and Normal float distributions
- Validated at 2M rows: actual matched predicted within 0.01%

### Marketplace packs (in realityDB Packs/)
All 6 marketplace packs score 97-100/100:
- fintech.json — transactions, fraud, multi-currency
- healthcare.json — clinical encounters, billing
- oncology.json — clinical trials, CTCAE
- supply-chain.json — 24 tables, full logistics
- telecom.json — subscribers, towers, usage
- universal.json — generic starter

Use these as distribution and structure references.
Note: most do NOT yet declare cardinality in relationships block.
FK ordering may also need audit. Use grid_silent_cascade as the
cardinality reference.

### demo_library.json
The canonical 100/100 reference for the assess command.
Located: `apps/cli/src/packs/demo_library.json`
Used in smoke test. Do not modify.

---

*Guide version: 2.0 — May 2026*
*Supersedes: PACK-AUTHORING-CHECKLIST.md (keep as quick reference)*
*Next update trigger: new engine version, new distribution type, new domain added*
