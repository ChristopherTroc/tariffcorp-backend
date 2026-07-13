# Tasks: TariffCorp Platform Core

## Task 1 — Project scaffold & NestJS bootstrap

**Goal:** Initialize the NestJS project, install all dependencies, configure ESLint/Prettier, wire the global `ValidationPipe` and `HttpExceptionFilter`, and mount Swagger UI.

**Files to create/modify:**
- `src/main.ts` — bootstrap with global pipe, filter, `setGlobalPrefix('api/v1')`, CORS, and `SwaggerModule.setup('api/docs', ...)`
- `src/app.module.ts` — root module importing `TradeModule`
- `.eslintrc.js` — `no-explicit-any: error`
- `.prettierrc` — `singleQuote: true`

**Dependencies to install:** `@nestjs/swagger`

**Acceptance:** `npm run build` succeeds; `GET /api/docs` returns 200 with Swagger UI HTML.

---

## Task 2 — Prisma schema & database connection

**Goal:** Write the Prisma schema with all three models and connect to the Supabase PostgreSQL instance via `DATABASE_URL`.

**Files to create/modify:**
- `prisma/schema.prisma` — `Product`, `Transaction`, `CheckerFinding` models exactly as specified in `design.md`
- `.env` — `DATABASE_URL` pointing to Supabase
- `src/trade/infrastructure/adapters/prisma-trade.adapter.ts` — `PrismaService` extending `PrismaClient`

**Acceptance:** `npx prisma migrate dev` runs successfully; `npx prisma generate` compiles client types with no errors.

---

## Task 3 — Port interfaces

**Goal:** Define the two port interfaces before any adapter or engine implementation, enforcing the hexagonal boundary.

**Files to create:**
- `src/trade/ports/database-port.interface.ts` — `IDatabasePort` with all methods from `design.md`, including `getProductById`, `getTransactionById`, paginated `getFindings`
- `src/trade/ports/checker-port.interface.ts` — `ICheckerPort` with `runForTransactionId(transactionId: string)` and `runForProduct(productId: string)`

**Acceptance:** Both files compile cleanly; no implementations yet.

---

## Task 4 — Seed script

**Goal:** Implement `prisma/seed.ts` to read `products.json` and `transactions.json` from the workspace root, upsert all records, then run the CheckerEngine over all transactions.

**Files to create/modify:**
- `prisma/seed.ts`:
  1. Read `/products.json` and `/transactions.json` with `fs/promises`
  2. Upsert all `Product` records first
  3. Upsert all `Transaction` records — if `product_id` is missing from the catalog, set `productId: null`
  4. Run `CheckerEngine` over every transaction to populate initial `CheckerFinding` rows
- `package.json` — add `"prisma": { "seed": "ts-node prisma/seed.ts" }`

**Acceptance:** `npx prisma db seed` completes without errors; row counts in DB match JSON source files; `checker_findings` table is populated after seed.

---

## Task 5 — CheckerEngine (domain, framework-free)

**Goal:** Implement the pure TypeScript rule engine with no NestJS or Prisma imports.

**Files to create:**
- `src/trade/domain/checker.engine.ts` — exports `CheckerEngine` class implementing `ICheckerPort`

  **`runForTransactionId(transactionId: string)`** (public, async):
  1. Fetch transaction via `IDatabasePort.getTransactionById`; throw `NotFoundException` if missing
  2. If `transaction.productId` is set, fetch product and override these fields on the working record: `countryOfOrigin`, `importCode`, `type`, `value`
  3. Run the rule pipeline (first-match-wins):
     - **R1** — `countryOfOrigin ∈ {TW, CN}` → duty = `$100` flat
     - **R2** — `countryOfOrigin === RU` AND `units >= 10` → duty = `units × unit_value × 0.05`
     - **R3** — `countryOfOrigin ∈ {DE, FR, IT, ES, NL}` AND `type === consumable` AND `total_value > 1000` → duty = `total_value × 0.15`
     - **default** — no rule matched → duty = `$0`
  4. Compute `exposure = dutyComputed − dutyDeclared`
  5. Persist via `IDatabasePort.upsertFinding({ transactionId, productId, ruleId, ruleName, dutyComputed, exposure })`

  **`runForProduct(productId: string)`** (public, async):
  1. Fetch all transactions for this product via `IDatabasePort.getTransactionsForProduct`
  2. Call `runForTransactionId` for each

**Acceptance:** All Jest unit tests in Task 6 pass; no imports from `@nestjs/*` or `@prisma/*` in this file.

---

## Task 6 — CheckerEngine unit tests

**Goal:** Cover every rule branch, all threshold boundary conditions, and the master-product override with isolated Jest tests. Must run without a database.

**Files to create:**
- `src/trade/domain/checker.engine.spec.ts`

Test cases (all use a stubbed `IDatabasePort`):

| Case | Input | Expected duty |
|------|-------|--------------|
| R1 — CN origin | `countryOfOrigin: CN`, 1 unit | $100 |
| R1 — TW origin | `countryOfOrigin: TW`, 1 unit | $100 |
| R1 negative — VN origin | `countryOfOrigin: VN` | $0 (no rule matches) |
| R2 — RU, 15 units, unit_value $50 | `countryOfOrigin: RU`, units 15, unit_value 50 | $37.50 (15×50×5%) |
| R2 — RU, exactly 10 units, unit_value $50 | `countryOfOrigin: RU`, units 10, unit_value 50 | $25 (10×50×5%) |
| R2 negative — RU, 9 units | `countryOfOrigin: RU`, units 9 | $0 (threshold not met) |
| R3 — DE + consumable + total_value $1200 | `countryOfOrigin: DE`, type consumable, total_value 1200 | $180 (1200×15%) |
| R3 — NL + consumable + total_value $2000 | `countryOfOrigin: NL`, type consumable, total_value 2000 | $300 (2000×15%) |
| R3 negative — DE + consumable + total_value $900 | total_value 900 | $0 (below threshold) |
| R3 negative — DE + electronics + total_value $2000 | type electronics | $0 (wrong type) |
| R3 negative — US + consumable + total_value $2000 | `countryOfOrigin: US` | $0 (wrong origin) |
| Override: declared US, product origin CN | transaction origin US, product origin CN | $100 (R1 fires after override) |
| Override: declared DE consumable $500, product origin RU 15 units | product overrides origin to RU | duty = R2 result |
| Exposure | duty_computed $100, duty_declared $30 | exposure $70 |
| Exposure negative | duty_computed $0, duty_declared $50 | exposure −$50 |

**Acceptance:** `npm test` runs all specs and all pass; no real DB or NestJS context used.

---

## Task 7 — Prisma adapter (`IDatabasePort` implementation)

**Goal:** Implement `PrismaTradeAdapter` satisfying `IDatabasePort`, keeping all Prisma queries isolated from domain code.

**Files to create/modify:**
- `src/trade/infrastructure/adapters/prisma-trade.adapter.ts`

Methods to implement:

**Products:**
- `getAllProducts(filters)` — `prisma.product.findMany` with optional `type` filter and pagination; each result includes `_count.checkerFindings` for `openFindingsCount`
- `getProductById(id)` — `prisma.product.findUnique({ where: { id }, include: { transactions: true, checkerFindings: true } })`
- `updateProduct(id, data)` — `prisma.product.update`

**Transactions:**
- `getAllTransactions(filters)` — offset pagination; filter by `productId IS NULL` for `status=unmatched`, by `broker`, by `portOfEntry`
- `getTransactionById(id)` — `prisma.transaction.findUnique({ where: { id }, include: { product: true, checkerFinding: true } })`
- `getTransactionsForProduct(productId)` — `prisma.transaction.findMany({ where: { productId } })`

**Findings:**
- `getFindings(filters)` — `prisma.checkerFinding.findMany({ orderBy: { exposure: 'desc' }, include: { transaction: true, product: true } })` with offset pagination
- `upsertFinding(finding)` — `prisma.checkerFinding.upsert` keyed on `transactionId`

**Dashboard:**
- `getDashboardStats()` — aggregate queries:
  - `totalExposure`: `_sum.exposure` over all findings
  - `totalDutyDeclared`: `_sum.dutyDeclared` over all transactions
  - `totalDutyComputed`: `_sum.dutyComputed` over all findings
  - `openFindingsCount`: `count` of all findings
  - `unmatchedTransactionsCount`: `count` where `productId IS NULL`
  - Top-5 byBroker, byPort, byProduct: `groupBy` queries on findings joined through transactions, ordered by `_sum.exposure DESC`, take 5

**Acceptance:** Adapter compiles with no TS errors; satisfies `IDatabasePort` type contract.

---

## Task 8 — TradeModule wiring

**Goal:** Register all providers and controllers in `TradeModule`.

**Files to create/modify:**
- `src/trade/trade.module.ts`
  - Providers: `PrismaTradeAdapter` (bound to `IDatabasePort` token), `CheckerEngine` (bound to `ICheckerPort` token)
  - Controllers: `DashboardController`, `TransactionsController`, `ProductsController`, `FindingsController`

**Acceptance:** Module compiles; `npm run build` passes.

---

## Task 9 — Controllers & DTOs

**Goal:** Implement all endpoints as thin controllers that delegate entirely to the ports, decorated with `@nestjs/swagger` annotations.

**Files to create:**

**DTOs** (`src/trade/infrastructure/dtos/`)
- `update-product.dto.ts` — all fields optional with `@IsOptional()` + `class-validator`; `type` as `@IsEnum`
- `list-transactions.dto.ts` — `page`, `per_page`, `status`, `broker`, `port_of_entry`
- `list-products.dto.ts` — `page`, `per_page`, `type`, `has_findings`
- `list-findings.dto.ts` — `page`, `per_page`

**`src/trade/infrastructure/controllers/dashboard.controller.ts`**
- `@ApiTags('dashboard')` on class
- `GET /dashboard/stats` → `IDatabasePort.getDashboardStats()`, returns `{ data: stats }`
- `@ApiOperation({ summary, description })` + `@ApiOkResponse` on the method

**`src/trade/infrastructure/controllers/transactions.controller.ts`**
- `@ApiTags('transactions')` on class
- `GET /transactions` → paginated list, query params from `ListTransactionsDto`
- `GET /transactions/:id` → detail with product + finding; `@ApiNotFoundResponse` documented
- `@ApiOperation` + response decorators on each method

**`src/trade/infrastructure/controllers/products.controller.ts`**
- `@ApiTags('products')` on class
- `GET /products` → paginated list with `openFindingsCount`
- `GET /products/:id` → detail with transactions + findings
- `PATCH /products/:id` → update + re-evaluate; `@ApiBadRequestResponse` + `@ApiNotFoundResponse`
- `@ApiOperation` + response decorators on each method

**`src/trade/infrastructure/controllers/findings.controller.ts`**
- `@ApiTags('findings')` on class
- `GET /findings` → paginated, always `exposure DESC`; `@ApiOperation` + `@ApiOkResponse`

**Acceptance:** All endpoints respond correctly; Swagger UI at `/api/docs` shows all 4 tag groups with correct descriptions; `ValidationPipe` rejects unknown fields on PATCH.

---

## Task 10 — End-to-end smoke test

**Goal:** Verify the full data flow and all rule branches produce correct results against the real seed data.

**Steps:**
1. `npx prisma db seed` — confirm products, transactions, and initial findings are all loaded
2. `GET /api/v1/dashboard/stats` — confirm `totalExposure > 0`, `totalDutyDeclared` and `totalDutyComputed` are both populated, `openFindingsCount > 0`, top offenders present
3. `GET /api/v1/transactions?status=unmatched` — confirm unmatched transactions appear in `data`
4. `GET /api/v1/transactions/:id` for a matched transaction — confirm `product` and `finding` are included in the response
5. `GET /api/v1/products` — confirm each product has `openFindingsCount`
6. `GET /api/v1/products/:id` — confirm detail includes `transactions` and `findings` arrays
7. `GET /api/v1/findings` — confirm ordered by `exposure DESC`, all finding fields present
8. `PATCH /api/v1/products/:id` with `{ "countryOfOrigin": "CN" }` — confirm 200 response
9. `GET /api/v1/findings` again — confirm findings for that product re-evaluated with R1 ($100 duty)
10. Manually verify R2 boundary: find a RU transaction with < 10 units — confirm its finding has `dutyComputed: 0`
11. `GET /api/docs` — confirm Swagger UI loads, all 4 tag groups visible (dashboard, transactions, products, findings), descriptions present, "Try it out" works for at least one endpoint

**Acceptance:** All steps return expected HTTP status codes and correct data; no 500 errors in logs; rule corrections propagate correctly after PATCH; Swagger UI is fully navigable.
