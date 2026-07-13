import { PrismaClient } from '@prisma/client';
import { readFile } from 'fs/promises';
import { join } from 'path';

// Use direct URL for seeding — transaction pooler (pgbouncer) doesn't support
// the extended query protocol needed for Prisma's prepared statements in bulk ops.
const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL ?? process.env.DATABASE_URL } },
});

interface RawProduct {
  id: string;
  name: string;
  type: string;
  import_code: string;
  country_of_origin: string;
  value: number;
  weight: number;
  unit: string;
}

interface RawTransaction {
  id: string;
  date: string;
  importer: string;
  broker: string;
  port_of_entry: string;
  product_id?: string | null;
  import_code: string;
  country_of_origin: string;
  units: number;
  unit_value: number;
  total_value: number;
  duty_declared: number;
}

interface CheckerResult {
  ruleId: string | null;
  ruleName: string | null;
  dutyComputed: number;
  exposure: number;
}

// ── Rule engine (inline, no NestJS deps) ──────────────────────────────────────

function runRuleEngine(
  tx: RawTransaction,
  product: RawProduct | null,
): CheckerResult {
  // Override declared fields with master product when matched
  const countryOfOrigin = product?.country_of_origin ?? tx.country_of_origin;
  const type = product?.type ?? null;
  const unitValue = tx.unit_value;
  const totalValue = tx.total_value;
  const units = tx.units;
  const dutyDeclared = tx.duty_declared;

  let dutyComputed = 0;
  let ruleId: string | null = null;
  let ruleName: string | null = null;

  // R1 — Asian flat tariff
  if (['TW', 'CN'].includes(countryOfOrigin)) {
    dutyComputed = 100;
    ruleId = 'R1';
    ruleName = 'Asian flat tariff';
  }
  // R2 — Russia high-volume surcharge (units >= 10)
  else if (countryOfOrigin === 'RU' && units >= 10) {
    dutyComputed = units * unitValue * 0.05;
    ruleId = 'R2';
    ruleName = 'Russia high-volume surcharge';
  }
  // R3 — EU consumables high-value duty
  else if (
    ['DE', 'FR', 'IT', 'ES', 'NL'].includes(countryOfOrigin) &&
    type === 'consumable' &&
    totalValue > 1000
  ) {
    dutyComputed = totalValue * 0.15;
    ruleId = 'R3';
    ruleName = 'EU consumables high-value duty';
  }

  return {
    ruleId,
    ruleName,
    dutyComputed,
    exposure: dutyComputed - dutyDeclared,
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Resolve paths relative to workspace root (backend-api/ is two levels up from backend/prisma/)
  const workspaceRoot = join(__dirname, '..', '..');
  const productsPath = join(workspaceRoot, 'products.json');
  const transactionsPath = join(workspaceRoot, 'transactions.json');

  const rawProducts: RawProduct[] = JSON.parse(
    await readFile(productsPath, 'utf-8'),
  );
  const rawTransactions: RawTransaction[] = JSON.parse(
    await readFile(transactionsPath, 'utf-8'),
  );

  console.log(
    `Seeding ${rawProducts.length} products and ${rawTransactions.length} transactions…`,
  );

  // Build a lookup map for quick product resolution
  const productMap = new Map<string, RawProduct>(
    rawProducts.map((p) => [p.id, p]),
  );

  // 1. Seed products (delete+insert for idempotency — 50 rows, safe)
  await prisma.checkerFinding.deleteMany({});
  await prisma.transaction.deleteMany({});
  await prisma.product.deleteMany({});

  await prisma.product.createMany({
    data: rawProducts.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      importCode: p.import_code,
      countryOfOrigin: p.country_of_origin,
      value: p.value,
      weight: p.weight,
      unit: p.unit,
    })),
  });
  console.log(`✓ ${rawProducts.length} products inserted`);

  // 2. Seed transactions (unknown product_id → null)
  await prisma.transaction.createMany({
    data: rawTransactions.map((t) => {
      const resolvedProductId =
        t.product_id && productMap.has(t.product_id) ? t.product_id : null;
      return {
        id: t.id,
        date: new Date(t.date),
        importer: t.importer,
        broker: t.broker,
        portOfEntry: t.port_of_entry,
        importCode: t.import_code,
        countryOfOrigin: t.country_of_origin,
        units: t.units,
        unitValue: t.unit_value,
        totalValue: t.total_value,
        dutyDeclared: t.duty_declared,
        productId: resolvedProductId,
      };
    }),
  });
  console.log(`✓ ${rawTransactions.length} transactions inserted`);

  // 3. Run checker over all transactions and batch-insert findings
  const findings = rawTransactions.map((t) => {
    const resolvedProductId =
      t.product_id && productMap.has(t.product_id) ? t.product_id : null;
    const product = resolvedProductId ? productMap.get(resolvedProductId)! : null;
    const result = runRuleEngine(t, product);
    return {
      transactionId: t.id,
      dutyComputed: result.dutyComputed,
      exposure: result.exposure,
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      productId: resolvedProductId,
    };
  });

  await prisma.checkerFinding.createMany({ data: findings });
  console.log(`✓ ${findings.length} checker findings inserted`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
