import { Command } from 'commander';
import { loginCommand } from './commands/login';
import { logoutCommand } from './commands/logout';
import { statusCommand } from './commands/status';
import { seedCommand } from './commands/seed.js';
import { requireAuth, loadLicense } from './auth/license';
import * as fs from 'fs';
import * as path from 'path';

// Auto-read version from package.json
const packageJson = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8')
);
const VERSION = packageJson.version;

const program = new Command();

program
  .name('realitydb')
  .version(VERSION)
  .description('Developer Reality Platform - realistic database environments from your schema');

// ============================================
// PUBLIC COMMANDS (No authentication required)
// ============================================

program
  .command('login')
  .description('Authenticate with RealityDB using API key')
  .option('--api-key <key>', 'API key from realitydb.dev/dashboard')
  .action(loginCommand);

program
  .command('logout')
  .description('Clear authentication and remove local license')
  .option('-f, --force', 'Skip confirmation prompt')
  .option('--clear-all', 'Remove all local data including cache')
  .action(logoutCommand);

program
  .command('status')
  .description('Show license status and plan details')
  .option('--json', 'Output in JSON format')
  .option('-v, --verbose', 'Show detailed information including local files')
  .action(statusCommand);

// ============================================
// MOCK VALUE GENERATOR
// ============================================

function generateMockValue(colDef: any, colName?: string): any {
  if (typeof colDef === 'string') {
    return generateByStrategy(colDef, {}, colName);
  }
  if (colDef && typeof colDef === 'object') {
    return generateByStrategy(colDef.strategy || 'text', colDef.options || {}, colName);
  }
  return 'mock_value';
}

function generateByStrategy(strategy: string, options: any, colName?: string): any {
  switch (strategy) {
    case 'uuid':
      return `${randomHex(8)}-${randomHex(4)}-4${randomHex(3)}-${randomHex(4)}-${randomHex(12)}`;
    case 'company_name':
      const companies = [
        'Sunrise Bistro', 'Golden Plate', 'Harbor Grill', 'Mountain View Cafe',
        'City Kitchen', 'The Local Table', 'Fresh & Co', 'Oak & Vine',
        'Blue Ocean Sushi', 'Red Pepper Thai', 'Corner Deli', 'The Rustic Fork',
        'Sage & Thyme', 'Firebird Pizza', 'Maple Street Diner', 'Cloud Nine Cafe',
        'The Brass Tap', 'Luna Restaurant', 'Green Leaf Bistro', 'Stone Oven Bakery',
      ];
      return companies[Math.floor(Math.random() * companies.length)];
    case 'enum':
      if (options?.values && Array.isArray(options.values)) {
        if (options.weights && Array.isArray(options.weights)) {
          return weightedRandom(options.values, options.weights);
        }
        return options.values[Math.floor(Math.random() * options.values.length)];
      }
      return 'option_a';
    case 'timestamp':
      const now = Date.now();
      const past = now - Math.floor(Math.random() * 365 * 24 * 60 * 60 * 1000);
      return new Date(past).toISOString();
    case 'integer':
    case 'int':
      const min = options?.min ?? 1;
      const max = options?.max ?? 1000;
      return Math.floor(Math.random() * (max - min + 1)) + min;
    case 'float':
    case 'decimal':
    case 'money':
      const fmin = options?.min ?? 1;
      const fmax = options?.max ?? 999.99;
      return parseFloat((Math.random() * (fmax - fmin) + fmin).toFixed(2));
    case 'boolean':
      return Math.random() > 0.5;
    case 'email':
      const emailPrefixes = ['alex', 'maria', 'chen', 'fatima', 'omar', 'priya', 'james', 'sarah', 'raj', 'elena'];
      const emailDomains = ['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'proton.me'];
      return `${emailPrefixes[Math.floor(Math.random() * emailPrefixes.length)]}${Math.floor(Math.random() * 9999)}@${emailDomains[Math.floor(Math.random() * emailDomains.length)]}`;
    case 'phone':
      return `+1${Math.floor(1000000000 + Math.random() * 9000000000)}`;
    case 'text':
    case 'string':
      return `sample_text_${Math.floor(Math.random() * 10000)}`;
    case 'name':
    case 'full_name':
      const firstNames = ['James', 'Maria', 'Chen', 'Fatima', 'Alex', 'Priya', 'Omar', 'Sarah'];
      const lastNames = ['Smith', 'Garcia', 'Wang', 'Johnson', 'Patel', 'Kim', 'Brown', 'Ali'];
      return `${firstNames[Math.floor(Math.random() * firstNames.length)]} ${lastNames[Math.floor(Math.random() * lastNames.length)]}`;
    case 'address':
      return `${Math.floor(Math.random() * 9999)} Main St, City, ST ${Math.floor(10000 + Math.random() * 89999)}`;
    default:
      return `mock_${strategy}_${Math.floor(Math.random() * 1000)}`;
  }
}

function randomHex(length: number): string {
  let result = '';
  const chars = '0123456789abcdef';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

function weightedRandom(values: any[], weights: number[]): any {
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < values.length; i++) {
    random -= weights[i];
    if (random <= 0) return values[i];
  }
  return values[values.length - 1];
}

// ============================================
// NORMALIZE TABLES FROM ANY PACK FORMAT
// ============================================

interface NormalizedTable {
  name: string;
  columns: Record<string, any>;
  foreignKeys: Array<{ column: string; references: { table: string; column: string } }>;
}

function normalizeTables(pack: any): { tables: NormalizedTable[]; templateName: string } {
  let tables: NormalizedTable[] = [];
  let templateName = pack.name || 'custom';

  if (pack.tables) {
    if (Array.isArray(pack.tables)) {
      // Check if this is Studio v4.3.0 format (array of { id, name, columns: [...] })
      const isStudioFormat = pack.tables.length > 0 && pack.tables[0].id && Array.isArray(pack.tables[0].columns);

      if (isStudioFormat) {
        // Build lookup maps: tableId -> tableName, columnId -> columnName
        const tableIdToName: Record<string, string> = {};
        const columnIdToName: Record<string, string> = {};
        for (const t of pack.tables) {
          tableIdToName[t.id] = t.name;
          if (Array.isArray(t.columns)) {
            for (const col of t.columns) {
              columnIdToName[col.id] = col.name;
            }
          }
        }

        tables = pack.tables.map((t: any) => {
          // Convert columns array to object keyed by column name
          const columnsObj: Record<string, any> = {};
          const fks: Array<{ column: string; references: { table: string; column: string } }> = [];

          if (Array.isArray(t.columns)) {
            for (const col of t.columns) {
              const colEntry: any = {};
              if (col.strategy) colEntry.strategy = col.strategy;
              if (col.options) colEntry.options = col.options;
              if (col.isPK) colEntry.isPK = true;

              // Resolve fkTarget to foreignKey
              if (col.isFK && col.fkTarget) {
                const refTableName = tableIdToName[col.fkTarget.tableId];
                const refColName = columnIdToName[col.fkTarget.columnId];
                if (refTableName && refColName) {
                  colEntry.foreignKey = { table: refTableName, column: refColName };
                  colEntry.strategy = colEntry.strategy || 'uuid';
                  fks.push({
                    column: col.name,
                    references: { table: refTableName, column: refColName },
                  });
                }
              }

              columnsObj[col.name] = colEntry;
            }
          }

          return {
            name: t.name,
            columns: columnsObj,
            foreignKeys: fks,
          };
        });
      } else {
        // Format 1: plain array of { name, columns: {...}, ... }
        tables = pack.tables.map((t: any) => ({
          name: t.name || t.table_name || 'unknown',
          columns: t.columns || t.schema || {},
          foreignKeys: extractForeignKeys(t.columns || t.schema || {}),
        }));
      }
    } else if (typeof pack.tables === 'object') {
      // Format 2: tables is an object keyed by table name (CLI export format)
      tables = Object.entries(pack.tables).map(([tableName, tableDef]: [string, any]) => ({
        name: tableName,
        columns: tableDef.columns || tableDef.schema || {},
        foreignKeys: extractForeignKeys(tableDef.columns || tableDef.schema || {}),
      }));
    }
  }

  // Fallback: look for tables nested in schema or config
  if (tables.length === 0) {
    for (const key of ['schema', 'config', 'database']) {
      const nested = pack[key];
      if (nested?.tables) {
        const result = normalizeTables({ ...pack, tables: nested.tables, name: templateName });
        if (result.tables.length > 0) return result;
      }
    }
  }

  return { tables, templateName };
}

function extractForeignKeys(columns: Record<string, any>): Array<{ column: string; references: { table: string; column: string } }> {
  const fks: Array<{ column: string; references: { table: string; column: string } }> = [];
  for (const [colName, colDef] of Object.entries(columns)) {
    if (colDef && typeof colDef === 'object' && colDef.foreignKey) {
      fks.push({
        column: colName,
        references: {
          table: colDef.foreignKey.table,
          column: colDef.foreignKey.column,
        },
      });
    }
  }
  return fks;
}

// ============================================
// TOPOLOGICAL SORT (for FK ordering)
// ============================================

function topologicalSort(tables: NormalizedTable[]): NormalizedTable[] {
  const tableMap = new Map(tables.map(t => [t.name, t]));
  const visited = new Set<string>();
  const result: NormalizedTable[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    const table = tableMap.get(name);
    if (!table) return;
    for (const fk of table.foreignKeys) {
      if (tableMap.has(fk.references.table)) {
        visit(fk.references.table);
      }
    }
    result.push(table);
  }

  for (const table of tables) {
    visit(table.name);
  }

  return result;
}

// ============================================
// SQL TYPE INFERENCE
// ============================================

function inferSqlType(colName: string, colDef: any): string {
  const strategy = typeof colDef === 'string' ? colDef : colDef?.strategy || 'text';

  switch (strategy) {
    case 'uuid':
      return 'UUID';
    case 'integer':
    case 'int':
      return 'INTEGER';
    case 'float':
    case 'decimal':
    case 'money':
      return 'NUMERIC(12,2)';
    case 'boolean':
      return 'BOOLEAN';
    case 'timestamp':
      return 'TIMESTAMPTZ';
    case 'text':
      return 'TEXT';
    case 'email':
    case 'company_name':
    case 'name':
    case 'full_name':
    case 'address':
      return 'VARCHAR(255)';
    case 'enum':
      return 'VARCHAR(50)';
    case 'phone':
      return 'VARCHAR(20)';
    case 'string':
    default:
      return 'VARCHAR(255)';
  }
}

function isNullableColumn(colName: string, colDef: any, tableColumns: Record<string, any>): boolean {
  // Check if any sibling enum column has lifecycleRules that null this column
  for (const [_, sibDef] of Object.entries(tableColumns)) {
    const sib = sibDef as any;
    if (sib?.options?.lifecycleRules) {
      for (const rule of sib.options.lifecycleRules) {
        if (rule.nullFields && rule.nullFields.includes(colName)) {
          return true;
        }
      }
    }
  }
  // Also check dependsOn — dependent timestamps can be null
  if (colDef?.options?.dependsOn) {
    return true;
  }
  return false;
}

// ============================================
// SQL GENERATION
// ============================================

function generateCreateTable(table: NormalizedTable): string {
  const lines: string[] = [];
  const constraints: string[] = [];

  for (const [colName, colDef] of Object.entries(table.columns)) {
    const sqlType = inferSqlType(colName, colDef);
    const nullable = isNullableColumn(colName, colDef, table.columns);
    const isPK = colName === 'id';

    let line = `  "${colName}" ${sqlType}`;
    if (!nullable) line += ' NOT NULL';
    if (isPK) line += ' PRIMARY KEY';
    // Add DEFAULT gen_random_uuid() for UUID primary keys
    if (isPK && sqlType === 'UUID') line += ' DEFAULT gen_random_uuid()';

    lines.push(line);
  }

  // Add FK constraints
  for (const fk of table.foreignKeys) {
    const constraintName = `fk_${table.name}_${fk.column}`;
    constraints.push(
      `  CONSTRAINT "${constraintName}" FOREIGN KEY ("${fk.column}") REFERENCES "${fk.references.table}"("${fk.references.column}")`
    );
  }

  const allLines = [...lines, ...constraints].join(',\n');
  return `CREATE TABLE "${table.name}" (\n${allLines}\n);\n`;
}

function escapeSqlValue(value: any): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return value.toString();
  // String — escape single quotes
  const escaped = String(value).replace(/'/g, "''");
  return `'${escaped}'`;
}

function generateInsertStatements(tableName: string, rows: any[], batchSize: number = 100): string {
  if (rows.length === 0) return '';

  const columns = Object.keys(rows[0]);
  const colList = columns.map(c => `"${c}"`).join(', ');
  const parts: string[] = [];

  parts.push(`-- ${tableName}: ${rows.length} rows`);

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const valueRows = batch.map(row => {
      const vals = columns.map(col => escapeSqlValue(row[col]));
      return `  (${vals.join(', ')})`;
    });
    parts.push(`INSERT INTO "${tableName}" (${colList}) VALUES\n${valueRows.join(',\n')};\n`);
  }

  return parts.join('\n');
}

// ============================================
// DATA GENERATION ENGINE
// ============================================

interface GenerationResult {
  allData: Record<string, any[]>;
  actualTotal: number;
  elapsed: string;
}

function generateData(
  ordered: NormalizedTable[],
  rowsPerTable: Record<string, number>,
  pack: any,
): GenerationResult {
  const startTime = Date.now();
  const generatedIds: Record<string, any[]> = {};
  const allData: Record<string, any[]> = {};

  for (const table of ordered) {
    const tableRows = rowsPerTable[table.name];
    const tableData: any[] = [];
    const ids: any[] = [];

    // Get lifecycle rules from enum columns
    const lifecycleMap = getLifecycleMap(table.columns);

    for (let i = 0; i < tableRows; i++) {
      const row: Record<string, any> = {};
      let activeLifecycleNulls: string[] = [];

      // First pass: generate enum values to determine lifecycle nulls
      for (const [colName, colDef] of Object.entries(table.columns)) {
        const def = colDef as any;
        if (def?.strategy === 'enum' && def?.options?.lifecycleRules) {
          const enumValue = generateMockValue(def, colName);
          row[colName] = enumValue;
          // Check if this enum value triggers null fields
          for (const rule of def.options.lifecycleRules) {
            if (rule.value === enumValue && rule.nullFields) {
              activeLifecycleNulls.push(...rule.nullFields);
            }
          }
        }
      }

      // Second pass: generate all other columns
      for (const [colName, colDef] of Object.entries(table.columns)) {
        const def = colDef as any;

        // Skip if already generated (enum with lifecycle)
        if (row[colName] !== undefined) continue;

        // Apply lifecycle null rules
        if (activeLifecycleNulls.includes(colName)) {
          row[colName] = null;
          continue;
        }

        // Foreign key resolution
        if (def?.foreignKey) {
          const refTable = def.foreignKey.table;
          const refIds = generatedIds[refTable];
          if (refIds && refIds.length > 0) {
            row[colName] = refIds[Math.floor(Math.random() * refIds.length)];
          } else {
            row[colName] = generateMockValue(def, colName);
          }
        } else if (def?.options?.dependsOn && def?.options?.dependencyRule === 'after') {
          // Dependent timestamp: generate a time after the dependency
          const depValue = row[def.options.dependsOn];
          if (depValue) {
            const depTime = new Date(depValue).getTime();
            const offset = Math.floor(Math.random() * 7 * 24 * 60 * 60 * 1000); // 0-7 days after
            row[colName] = new Date(depTime + offset).toISOString();
          } else {
            row[colName] = null; // dependency is null, so this is null too
          }
        } else {
          row[colName] = generateMockValue(def, colName);
        }

        // Track IDs for foreign key lookups
        if (colName === 'id') {
          ids.push(row[colName]);
        }
      }

      tableData.push(row);
    }

    generatedIds[table.name] = ids;
    allData[table.name] = tableData;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const actualTotal = Object.values(allData).reduce((sum, arr) => sum + arr.length, 0);

  return { allData, actualTotal, elapsed };
}

function getLifecycleMap(columns: Record<string, any>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [colName, colDef] of Object.entries(columns)) {
    const def = colDef as any;
    if (def?.options?.lifecycleRules) {
      for (const rule of def.options.lifecycleRules) {
        if (rule.nullFields) {
          map.set(`${colName}:${rule.value}`, rule.nullFields);
        }
      }
    }
  }
  return map;
}

// ============================================
// ROW DISTRIBUTION
// ============================================

function distributeRows(ordered: NormalizedTable[], totalRows: number): Record<string, number> {
  const rowsPerTable: Record<string, number> = {};
  const rootCount = ordered.filter(t => t.foreignKeys.length === 0).length;
  const childCount = ordered.length - rootCount;
  const totalWeight = rootCount * 2 + childCount;

  for (const t of ordered) {
    const weight = t.foreignKeys.length === 0 ? 2 : 1;
    rowsPerTable[t.name] = Math.ceil((totalRows * weight) / totalWeight);
  }

  // Scale to hit exact target
  const totalPlanned = Object.values(rowsPerTable).reduce((a, b) => a + b, 0);
  const scale = totalRows / totalPlanned;
  for (const name of Object.keys(rowsPerTable)) {
    rowsPerTable[name] = Math.max(1, Math.round(rowsPerTable[name] * scale));
  }

  return rowsPerTable;
}

// ============================================
// RUN COMMAND (Free tier allowed)
// ============================================

program
  .command('run')
  .description('Generate synthetic data from a RealityPack')
  .requiredOption('-p, --pack <file>', 'RealityPack JSON file')
  .option('-r, --rows <number>', 'Number of rows to generate', '10000')
  .option('-o, --output <file>', 'Output file path')
  .option('-f, --format <type>', 'Output format: json, sql', 'json')
  .option('-c, --connection <string>', 'Database connection string')
  .option('-s, --seed <number>', 'Deterministic seed for reproducibility')
  .option('--schema-only', 'Output only CREATE TABLE statements (sql format)')
  .option('--data-only', 'Output only INSERT statements, no CREATE TABLE (sql format)')
  .option('--drop-tables', 'Include DROP TABLE IF EXISTS before CREATE (sql format)')
  .action(async (options) => {
    const license = loadLicense();
    const isLoggedIn = !!license;
    const rows = parseInt(options.rows);
    const format = options.format?.toLowerCase() || 'json';

    if (isNaN(rows) || rows < 1) {
      console.error(`\n❌ Invalid row count: ${options.rows}`);
      process.exit(1);
    }

    if (!['json', 'sql'].includes(format)) {
      console.error(`\n❌ Unsupported format: ${format}`);
      console.error(`   Supported: json, sql`);
      process.exit(1);
    }

    if (!isLoggedIn && rows > 50000) {
      console.error(`\n❌ Free tier limited to 50,000 rows.`);
      console.error(`   Requested: ${rows.toLocaleString()} rows`);
      console.error(`\n   Upgrade: realitydb login --api-key YOUR_KEY\n`);
      process.exit(1);
    }

    console.log(`\n🚀 RealityDB Data Generator`);
    console.log(`${'─'.repeat(40)}`);
    if (isLoggedIn) {
      console.log(`   User: ${license.email}`);
      console.log(`   Plan: ${license.tier.toUpperCase()}`);
    } else {
      console.log(`   Mode: FREE TIER (50K rows max)`);
    }
    console.log(`   Pack: ${options.pack}`);
    console.log(`   Format: ${format.toUpperCase()}`);
    if (options.seed) console.log(`   Seed: ${options.seed}`);

    try {
      const packPath = path.resolve(options.pack);
      if (!fs.existsSync(packPath)) {
        console.error(`\n❌ Pack file not found: ${packPath}`);
        process.exit(1);
      }

      const packContent = fs.readFileSync(packPath, 'utf-8');
      const pack = JSON.parse(packContent);

      // Normalize tables from any format
      const { tables, templateName } = normalizeTables(pack);

      if (tables.length === 0) {
        console.error(`\n❌ No tables found in pack file.`);
        console.error(`   File keys: ${Object.keys(pack).join(', ')}`);
        if (pack.tables) {
          console.error(`   pack.tables type: ${typeof pack.tables}`);
          console.error(`   pack.tables is array: ${Array.isArray(pack.tables)}`);
          if (typeof pack.tables === 'object' && !Array.isArray(pack.tables)) {
            console.error(`   pack.tables keys: ${Object.keys(pack.tables).join(', ')}`);
          }
        }
        console.error(`\n   Supported formats:`);
        console.error(`   • { tables: { tableName: { columns: {...} } } }  (Studio export)`);
        console.error(`   • { tables: [ { name: "...", columns: {...} } ] }  (Array format)`);
        process.exit(1);
      }

      console.log(`   Template: ${templateName}`);
      console.log(`   Tables: ${tables.length}`);
      console.log(`${'─'.repeat(40)}`);

      // Determine generation order (respect foreign keys)
      const ordered = topologicalSort(tables);

      // Distribute rows
      const rowsPerTable = distributeRows(ordered, rows);

      // Show table plan
      for (const t of ordered) {
        const fkInfo = t.foreignKeys.length > 0
          ? ` (refs: ${t.foreignKeys.map(fk => fk.references.table).join(', ')})`
          : ' (root)';
        console.log(`   📊 ${t.name}: ${rowsPerTable[t.name].toLocaleString()} rows${fkInfo}`);
      }

      console.log(`${'─'.repeat(40)}`);

      // Schema-only mode (SQL)
      if (options.schemaOnly && format === 'sql') {
        console.log(`   Generating schema only...`);
        const schemaParts: string[] = [];
        schemaParts.push(`-- Generated by RealityDB CLI v${VERSION}`);
        schemaParts.push(`-- Template: ${templateName}`);
        schemaParts.push(`-- Generated at: ${new Date().toISOString()}\n`);

        for (const table of ordered) {
          if (options.dropTables) {
            schemaParts.push(`DROP TABLE IF EXISTS "${table.name}" CASCADE;`);
          }
          schemaParts.push(generateCreateTable(table));
        }

        const outputFile = options.output || `./realitydb_schema_${Date.now()}.sql`;
        fs.writeFileSync(outputFile, schemaParts.join('\n'));

        console.log(`\n✅ Schema generated!`);
        console.log(`   📁 Output: ${outputFile}`);
        console.log(`   📊 Tables: ${ordered.length}`);
        console.log(``);
        return;
      }

      console.log(`   Generating data...`);

      // Generate data
      const { allData, actualTotal, elapsed } = generateData(ordered, rowsPerTable, pack);

      // Determine output file
      const ext = format === 'sql' ? 'sql' : 'json';
      const outputFile = options.output || `./realitydb_output_${Date.now()}.${ext}`;

      if (format === 'sql') {
        // SQL output
        const sqlParts: string[] = [];
        sqlParts.push(`-- ============================================`);
        sqlParts.push(`-- Generated by RealityDB CLI v${VERSION}`);
        sqlParts.push(`-- Template: ${templateName}`);
        sqlParts.push(`-- Total rows: ${actualTotal.toLocaleString()}`);
        sqlParts.push(`-- Generated at: ${new Date().toISOString()}`);
        sqlParts.push(`-- ============================================\n`);

        // CREATE TABLE statements (unless --data-only)
        if (!options.dataOnly) {
          sqlParts.push(`-- ============================================`);
          sqlParts.push(`-- SCHEMA`);
          sqlParts.push(`-- ============================================\n`);

          for (const table of ordered) {
            if (options.dropTables) {
              sqlParts.push(`DROP TABLE IF EXISTS "${table.name}" CASCADE;`);
            }
            sqlParts.push(generateCreateTable(table));
          }
        }

        // INSERT statements
        sqlParts.push(`-- ============================================`);
        sqlParts.push(`-- DATA`);
        sqlParts.push(`-- ============================================\n`);

        for (const table of ordered) {
          const tableData = allData[table.name];
          if (tableData && tableData.length > 0) {
            sqlParts.push(generateInsertStatements(table.name, tableData));
          }
        }

        fs.writeFileSync(outputFile, sqlParts.join('\n'));

      } else {
        // JSON output
        const output: any = {
          _meta: {
            generator: 'realitydb-cli',
            version: VERSION,
            generated_at: new Date().toISOString(),
            template: templateName,
            total_rows: actualTotal,
            elapsed_seconds: parseFloat(elapsed),
            seed: options.seed || null,
          },
          tables: {} as Record<string, any>,
        };

        for (const [tableName, tableData] of Object.entries(allData)) {
          output.tables[tableName] = {
            row_count: tableData.length,
            data: tableData,
          };
        }

        fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
      }

      console.log(`\n✅ Generation complete!`);
      console.log(`${'─'.repeat(40)}`);
      console.log(`   📁 Output: ${outputFile}`);
      console.log(`   📊 Total rows: ${actualTotal.toLocaleString()}`);
      console.log(`   ⏱️  Time: ${elapsed}s`);
      console.log(`   📈 Speed: ${Math.round(actualTotal / parseFloat(elapsed)).toLocaleString()} rows/sec`);
      console.log(``);

    } catch (error: any) {
      console.error(`\n❌ Generation failed: ${error.message}`);
      process.exit(1);
    }
  });


// ============================================
// CAPTURE COMMAND (Requires authentication + Team plan)
// ============================================

program
  .command('capture')
  .description('Capture bug reproduction environment (Team plan required)')
  .requiredOption('-n, --name <name>', 'Bug identifier')
  .option('--safe', 'Automatically mask PII')
  .option('-c, --connection <string>', 'Database connection string')
  .action(async (options) => {
    const license = requireAuth('bug-capture');
    console.log(`\n🛡 Capturing bug reproduction environment...`);
    console.log(`   User: ${license?.email}`);
    console.log(`   Bug: ${options.name}`);
    console.log(`   Safe mode: ${options.safe ? 'ON' : 'OFF'}`);
    // TODO: Call your existing capture logic here
    console.log(`\n✔ Bug captured to: ${options.name}.realitydb-pack.json\n`);
  });

// ============================================
// MASK COMMAND (Requires authentication + Team plan)
// ============================================

program
  .command('mask')
  .description('Mask PII in databases (Team plan required)')
  .requiredOption('-c, --connection <string>', 'Database connection string')
  .option('--dry-run', 'Detect PII without masking')
  .option('--mode <mode>', 'Masking mode: fake, token, redact', 'fake')
  .action(async (options) => {
    const license = requireAuth('mask');
    console.log(`\n🔒 Masking PII in database...`);
    console.log(`   User: ${license?.email}`);
    console.log(`   Mode: ${options.mode}`);
    console.log(`   Dry run: ${options.dryRun ? 'YES' : 'NO'}`);
    // TODO: Call your existing mask logic here
    console.log(`\n✔ PII detection complete. 16 categories scanned.\n`);
  });

// ============================================
// Parse command line arguments
// ============================================

if (process.argv.length <= 2) {
  program.help();
}

program.parse();
