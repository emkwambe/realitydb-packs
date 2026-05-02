# AML — Anti-Money Laundering Variant (v1.0.0)

> **Domain:** finance.aml
> **Tables:** 9 | **Columns:** 101 | **Enums:** 27 (all weighted, all cited)
> **FK relationships:** 10 | **Date:** April 2026
> **Reference:** `FINANCIAL-VARIANTS-RESEARCH.md` (Mpingo internal)

---

## What this dataset models

Anti-Money Laundering surveillance data as it exists inside a US retail/commercial bank. The schema captures the entities that AML transaction-monitoring systems (TMS), KYC/CIP programs, and SAR-filing workflows operate on:

- **Customers and their KYC profile** — risk tier, country, occupation, PEP/sanctions flags
- **Identity documents** — driver's licenses, passports, utility bills (the inputs to CIP)
- **Devices** — fingerprints, IPs, device types (the network-graph signal)
- **Accounts** — checking, savings, money market, offshore (with home-branch FK)
- **Branches** — geographic context for the "deposits at 5 different branches" red flag
- **Beneficiaries** — saved payee contacts (the hub-and-spoke smurfing signal)
- **Transactions** — cash deposits, withdrawals, ACH, card, ATM
- **Wire transfers** — originator + beneficiary FK pair (the layering graph)
- **SARs** — Suspicious Activity Reports filed to FinCEN

## Typologies represented (at the schema level)

| Typology | Where it lives | What's encoded |
|---|---|---|
| **Structuring (single-actor)** | `transactions.transaction_class = structuring_suspect` | 4% of transactions classified as suspect; CTR threshold ($10K) implicit in `is_ctr_filed` rate (~3%) |
| **Smurfing (multi-actor)** | `transactions.branch_id` + `customers` country mix | Geographic dispersion across branches enabled by branch FK on every transaction |
| **Layering** | `wire_transfers.originator_account_id` + `beneficiary_id` | Two FKs let layering chains be modeled (with engine gap — see below) |
| **Hub-and-spoke** | `beneficiaries` shared across customers | Schema permits multiple customers to point at same beneficiary by account/name |
| **Cuckoo smurfing** | `wire_transfers.is_cross_border` + `purpose_code = remittance` | Cross-border remittance flag (~18% trueWeight) |
| **Synthetic identity** | `kyc_documents.document_number` | Document number column exists for the network signal |

## Citations summary

Every enum has a `_citation` field. Sources span:

- **FinCEN** — FY2024 Annual Review (4.7M SARs, 20.5M CTRs); SAR typology distribution; structuring statute 31 USC §5324
- **BSA / IRS** — IRM 4.26.13 (Structuring); CTR threshold of $10,000
- **FATF** — High-risk jurisdiction list (UAE, Cayman, Panama, etc.)
- **FFIEC** — Branch Office Survey 2024; Call Report 2024 (account status)
- **Federal Reserve** — Payments Study 2024; Wire Statistics 2024
- **BIS** — Triennial Central Bank Survey 2022 (currency mix)
- **NACHA** — ACH Originator Survey 2023 (beneficiary relationship mix)
- **Industry KYC** — LexisNexis 2024, Persona/Jumio 2024 verification rates
- **Bureau of Labor Statistics** — 2024 occupation distribution

## Cardinality (Moat 4)

Designed for non-flat row distribution at 5K total:

| Table | Approx rows | Why this size |
|---|---:|---|
| branches | 50 | Real US bank branches range 50–4,800; 50 enables visible dispersion |
| customers | 600 | Root entity, sized for ~10× transaction:customer ratio |
| kyc_documents | 700 | ~1.2 docs/customer (most have 1; some have ID + proof of address) |
| devices | 850 | ~1.4 devices/customer (mobile + desktop common) |
| accounts | 800 | ~1.3 accounts/customer (most have 1, some 2-3) |
| beneficiaries | 900 | ~1.1 saved payees/account |
| transactions | 700 | The bulk of activity; sized for query realism |
| wire_transfers | 350 | Wires are rarer than retail transactions |
| sars | 50 | ~5% SAR rate per FinCEN typical bank |

Total: ~5,000 rows.

## Quality moats — status

| Moat | Status | Notes |
|---|---|---|
| 1. FK integrity | ✅ Will pass at 100% | Every FK declared with `fkTarget` |
| 2. Temporal ordering | ⚠️ Partial | `past_date`/`future_date` strategies set realistic ranges, but engine doesn't enforce parent.created_at ≤ child.created_at |
| 3. Lifecycle states | ❌ Not enforced | Same engine gap as all current templates. Documented in `_engine_gaps`. |
| 4. Cardinality ratios | ✅ Designed in | Row counts deliberately non-flat (see table above) |
| 5. Provenance | ✅ Will embed | `_realitydb_meta` watermark added by engine at run time |
| 6. Quality score | ⏳ Pending | Target ≥95/100 with Privacy = 100/100. Run `examine assess` after Gate 4 to verify. |

## Known engine gaps (also encoded in `_engine_gaps` field of the JSON)

These are limitations of the current RealityDB engine, **not bugs in this schema**. The schema is built so that when each gap is closed in the engine, this dataset gets better automatically.

### Gap 1: Amount-class correlation
- **Problem:** A row with `transaction_class = structuring_suspect` will not necessarily have `amount_usd` near $9,000–$9,999. The engine generates each column independently.
- **Consequence for ML:** Detection models trained on this dataset alone will not learn "amount near 10K → structuring." Use this dataset for schema/integration testing, not for fraud-model training, until the gap is fixed.
- **Fix path:** Add a `conditional` strategy that takes another column as input. E.g., `{"strategy": "conditional", "on": "transaction_class", "when": {"structuring_suspect": {"strategy": "float", "min": 9000, "max": 9999}, "default": {"strategy": "float", "min": 5, "max": 24999.99}}}`.

### Gap 2: Layering graph structure
- **Problem:** `wire_transfers` has the right two FKs (originator + beneficiary), but the engine doesn't generate sequenced 3-hop chains (A → B → C → D within hours).
- **Consequence:** Wire transfers will have valid FKs but no temporal chain structure. Graph queries that look for layering chains won't find them.
- **Fix path:** Add a `chain` generator that takes a parent FK and generates N linked children with monotonic timestamps and shared funding flow.

### Gap 3: Shared-attribute network signals
- **Problem:** `device_fingerprint`, `ip_address`, `document_number` are 1:1 unique by default. Real smurf rings share these across "unrelated" customers.
- **Consequence:** Queries like `SELECT device_fingerprint FROM devices GROUP BY device_fingerprint HAVING COUNT(DISTINCT customer_id) > 3` will return zero rows.
- **Fix path:** Add a `pool` strategy that draws from a finite shared set. E.g., `{"strategy": "pool", "size": 50, "underlying": "template", ...}` reuses 50 fingerprints across 800 customer rows.

### Gap 4: Lifecycle state machines (Moat 3)
- **Problem:** No engine-side validation that, e.g., a `closed` account has `closed_at >= opened_at`, or that a `filed` SAR has `filed_at >= incident_date`.
- **Consequence:** Same as every current RealityDB template. Documented in `QUALITY-STANDARDS.md` honest-gaps section.
- **Fix path:** Engine-wide P0 fix. Lifecycle rules live in pack JSON under `lifecycleRules` once the engine reads them.

## Intended use cases

**Good fits:**
- Schema integration testing for AML/TMS vendors
- Demo data for compliance product walkthroughs
- SQL/query-development training (KYC, SAR, transaction monitoring queries)
- Compliance team training on data structure
- Data-mesh / data-catalog / lineage tooling demos

**Not yet fits (until engine gaps close):**
- Fraud detection ML model training (Gap 1)
- Network-graph analytics demos (Gap 3)
- Layering-detection algorithm validation (Gap 2)

## Files in this pack

| File | Purpose |
|---|---|
| `aml-v1.json` | Studio v4 source schema (input to `comply doctor --fix`) |
| `aml-ready.json` | (after Gate 3) studio-export format the CLI accepts |
| `aml-inspect.sql` | (after Gate 4) 500-row sample for inspection |
| `aml-5k.sql` | (after Gate 6) production 5K-row dataset |
| `aml-10k.sql` | (after Gate 6) production 10K-row dataset |
| `RUNBOOK.md` | Exact PowerShell commands for Gates 1–7 |
| `README.md` | This file |

## Strategic positioning

This is the **first finance variant** in the Financial pack series. It deliberately raises the bar above the existing `fintech` and `banking` templates (which use uniform enums) by:

1. Using research-backed enums with citations everywhere
2. Modeling the regulatory framework (CTR, SAR, FinCEN, FATF) explicitly
3. Documenting engine gaps publicly rather than hiding them
4. Designing for the next 9 financial variants — `customers`, `accounts`, `branches` will be reused / extended

When this variant ships, it becomes the **template-for-templates** for Credit Risk, Impossible Travel Fraud, Insurance Lifecycle, SaaS Billing, and the rest.

---

*Mpingo Systems LLC — Precision Tools built to stay.*
