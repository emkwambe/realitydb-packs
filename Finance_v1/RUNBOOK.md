# AML Pack — Runbook (Gates 1–7)

> **Pack:** `aml-anti-money-laundering` v1.0.0
> **Target location:** `C:\Users\HP\Documents\realityDB Packs\Finance_v1\`
> **CLI version required:** v2.37.7 (or whatever's published when you run this)
> **Convention:** All paths absolute. PowerShell only. UTF-8 without BOM.

---

## Prep — drop the schema into your packs directory

Save `aml-v1.json` (the file I built) to the Finance_v1 directory. From PowerShell:

```powershell
# Create the directory if needed
New-Item -ItemType Directory -Path "C:\Users\HP\Documents\realityDB Packs\Finance_v1" -Force | Out-Null

# Copy the file. Replace <DOWNLOAD_PATH> with wherever you saved aml-v1.json from this chat.
Copy-Item "<DOWNLOAD_PATH>\aml-v1.json" "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json"

# Sanity check — should be ~49 KB, no BOM
Get-Item "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json" | Format-List Name,Length
```

If the file came down with BOM (rare from a browser save), strip it:

```powershell
$content = [System.IO.File]::ReadAllText("C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json")
[System.IO.File]::WriteAllText("C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json", $content)
```

---

## Gate 1 — Confirm CLI build is current

```powershell
# Verify CLI version
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" --version

# If there have been engine changes since last build, rebuild with full cache clear:
npx turbo daemon stop
Remove-Item "$env:LOCALAPPDATA\turbo" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "C:\Users\HP\Documents\databox\.turbo" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item "C:\Users\HP\Documents\databox\apps\cli\dist" -Recurse -Force -ErrorAction SilentlyContinue
Set-Location "C:\Users\HP\Documents\databox"
npm run build
```

**Pass criteria:** `--version` returns 2.37.7 or later, no build errors.

---

## Gate 2 — Research-backed enum check

Already passed at schema-build time. Every enum has weights summing to ~100 with a `_citation`. To re-verify locally:

```powershell
$schema = Get-Content "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json" -Raw | ConvertFrom-Json

$weighted = 0
$uniform = 0
$missingCite = 0

foreach ($t in $schema.tables) {
  foreach ($c in $t.columns) {
    if ($c.strategy -eq "enum") {
      $opts = $c.options
      if ($opts.weights -and $opts._citation) { $weighted++ }
      elseif ($opts.weights) { $missingCite++ }
      else { $uniform++ }
    }
  }
}

Write-Host "Weighted with citation: $weighted"
Write-Host "Weighted, no citation:  $missingCite"
Write-Host "Uniform:                $uniform"
if ($uniform -eq 0 -and $missingCite -eq 0) { Write-Host "GATE 2: PASS" -ForegroundColor Green }
else { Write-Host "GATE 2: FAIL" -ForegroundColor Red }
```

**Pass criteria:** `Weighted: 27 | Uniform: 0 | Missing citation: 0`

---

## Gate 3 — Doctor check + format conversion

```powershell
# First, run the doctor in inspect mode to see what comes up
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" comply doctor --pack "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json"

# Then convert to studio-export format
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" comply doctor `
  --pack "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-v1.json" `
  --fix `
  --output "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-ready.json"
```

**Pass criteria:** Zero critical errors after `--fix`. The "format" warning is expected and fixed by `--fix`.

**If you see other errors:** stop and bring them back to chat. The schema is audited but the CLI doctor may catch something I missed.

---

## Gate 4 — Generate small sample + inspect

```powershell
# Generate 500 rows for inspection
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" run `
  --pack "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-ready.json" `
  --rows 500 `
  --format sql `
  --seed 42 `
  -o "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-inspect.sql"

# Mock-value check (must ALL print PASS in green)
$content = Get-Content "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-inspect.sql" -Raw
@('mock_past_date','mock_future_date','mock_template','sample_text_','mock_city','mock_state','mock_ip','mock_number') | ForEach-Object {
  if ($content -match $_) { Write-Host "FAIL: Found '$_'" -ForegroundColor Red }
  else { Write-Host "PASS: No '$_'" -ForegroundColor Green }
}

# Eyeball the first INSERT for each table
$lines = Get-Content "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-inspect.sql"
$insertLines = $lines | Select-String "INSERT INTO" | Select-Object -First 9
foreach ($il in $insertLines) {
  $i = $il.LineNumber - 1
  Write-Host ""
  Write-Host $lines[$i].Substring(0, [Math]::Min(160, $lines[$i].Length)) -ForegroundColor Cyan
  if ($i + 1 -lt $lines.Count) {
    Write-Host $lines[$i+1].Substring(0, [Math]::Min(160, $lines[$i+1].Length))
  }
}
```

**Pass criteria:**
- All 8 mock patterns print `PASS: No '...'`
- Every table has at least one INSERT row
- Sample rows look plausible (real names, real cities, ISO timestamps, no `<undefined>` or empty-string columns)

**If you find a mock value:** the engine is missing a strategy. Check `packages/engine/src/generators.ts` and the strategy used in the failing column.

---

## Gate 5 — Quality assessment

```powershell
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" examine assess `
  "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-inspect.sql"
```

**Pass criteria:**
- Overall ≥ 95/100
- Privacy = 100/100 (synthetic provenance detected via `_realitydb_meta`)
- Fidelity ≥ 90/100
- Structure ≥ 95/100

**If Privacy < 100:** the watermark embedding failed. Check that `_realitydb_meta` table appears in the SQL.

**If Overall < 95:** likely a Fidelity issue from low diversity. Investigate which column flagged.

---

## Gate 6 — Generate production sizes

```powershell
# 5K rows
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" run `
  --pack "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-ready.json" `
  --rows 5000 `
  --format sql `
  --seed 42 `
  -o "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-5k.sql"

# 10K rows
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" run `
  --pack "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-ready.json" `
  --rows 10000 `
  --format sql `
  --seed 42 `
  -o "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-10k.sql"

# Re-assess both
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" examine assess "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-5k.sql"
node "C:\Users\HP\Documents\databox\apps\cli\dist\index.js" examine assess "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-10k.sql"
```

**Pass criteria:** Both score ≥95/100 with Privacy = 100/100.

---

## Gate 7 — Upload to R2

```powershell
Set-Location "C:\Users\HP\Documents\databox\workers\lab-api"

npx wrangler r2 object put "realitydb-templates/templates/aml-5k.sql" `
  --file "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-5k.sql" `
  --remote

npx wrangler r2 object put "realitydb-templates/templates/aml-10k.sql" `
  --file "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-10k.sql" `
  --remote
```

**Pass criteria:** Both uploads return `Successfully created object`.

---

## (Optional) Bundle in CLI

Only if the variant is going free-tier and universally useful. AML may be better as a paid-tier Store offering — your call. To bundle:

```powershell
# Copy ready JSON to packs directory
Copy-Item "C:\Users\HP\Documents\realityDB Packs\Finance_v1\aml-ready.json" `
  "C:\Users\HP\Documents\databox\apps\cli\src\packs\aml.json"

# Add 'aml' entry to BUILT_IN_PACKS in apps/cli/src/index.ts (~line 190)

# Rebuild and smoke-test
Set-Location "C:\Users\HP\Documents\databox\apps\cli"
npx tsup
npm run postbuild
node dist\index.js run --pack list
node dist\index.js run --pack aml --rows 100 --format sql --seed 42 -o test-aml.sql
npm test  # must be 146+ tests, all green

# Bump version, publish
# (edit package.json version, then:)
npm publish
```

---

## (Optional) Add to Store catalog

Update three files:

1. **`workers/lab-api/src/index.ts`** — add `aml` entry to `DATASET_PRICING`
2. **`realitydb-sandbox/src/components/DataStorePage.tsx`** — add to `TEMPLATE_META`
3. **`realitydb-sandbox/src/components/SimLabPage.tsx`** — add to `TEMPLATE_META`

Then deploy:

```powershell
# Lab API
Set-Location "C:\Users\HP\Documents\databox\workers\lab-api"
npx wrangler deploy

# Sandbox
Set-Location "C:\Users\HP\Documents\realitydb-sandbox"
npm run build
npx wrangler pages deploy dist --project-name realitydb-sandbox --commit-dirty=true
```

---

## What to do if any gate fails

| Gate | Failure mode | Likely cause | Action |
|---|---|---|---|
| 1 | Build error | Engine change unbuilt | Full cache clear (see Gate 1 second block) |
| 2 | Uniform enum found | Schema regression | Should not happen — file's been audited. Re-run audit. |
| 3 | Doctor critical errors | FK target invalid or PK missing | Bring error text back to chat |
| 4 | Mock value found | Engine missing strategy | Identify which column; check `generators.ts` |
| 4 | Empty inserts | Strategy returned null | Same as above |
| 5 | Privacy < 100 | Watermark not embedded | Check `_realitydb_meta` table in SQL output |
| 5 | Overall < 95 | Fidelity issue | Check which pillar failed; usually low diversity |
| 6 | 10K differs from 5K assessment | Should be same shape | Investigate row distribution at scale |
| 7 | Upload fails | R2 auth or path | `npx wrangler whoami` and check bucket name |

Bring failures back here and I'll work them with you.

---

## Once all gates pass

Update `QUALITY-STANDARDS.md` scorecard:

| # | Template | Score | Moat 1 | Moat 2 | Moat 3 | Moat 4 | Moat 5 | Moat 6 | Status |
|---|---|---|---|---|---|---|---|---|---|
| 14 | aml | (your score) | ✅ | ✅ | — | ✅ | ✅ | ✅ | Published (research-backed) |

And then we move on to **Credit Risk** as variant #2 of the Finance pack.

---

*Mpingo Systems LLC — Precision Tools built to stay.*
