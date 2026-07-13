# Design: TariffCorp Platform Core

## Architecture Overview

Lightweight Hexagonal (Ports & Adapters) architecture inside a single NestJS `TradeModule`. Domain logic lives in framework-free TypeScript; NestJS infrastructure wires it together.

```
src/
├── app.module.ts
├── main.ts                            # Bootstrap: global pipe, filter, CORS, Swagger
└── trade/
    ├── trade.module.ts
    ├── domain/
    │   └── checker.engine.ts          # Pure TS rule engine, no NestJS imports
    ├── ports/
    │   ├── database-port.interface.ts # IDatabasePort — output port
    │   └── checker-port.interface.ts  # ICheckerPort  — input port
    └── infrastructure/
        ├── controllers/
        │   ├── dashboard.controller.ts
        │   ├── findings.controller.ts
        │   ├── products.controller.ts
        │   └── transactions.controller.ts
        ├── dtos/
        │   ├── list-findings.dto.ts
        │   ├── list-products.dto.ts
        │   ├── list-transactions.dto.ts
        │   └── update-product.dto.ts
        └── adapters/
            ├── prisma.service.ts
            └── prisma-trade.adapter.ts
```

## Database Schema

Three Prisma models on Supabase PostgreSQL:

**`products`** — master catalog; primary key is the string ID from `products.json`.  
**`transactions`** — customs declarations; optional `product_id` FK (SetNull on delete).  
**`checker_findings`** — one-to-one with transactions; stores `duty_computed`, `exposure`, and the rule that fired. Indexed on `exposure DESC` for native sort performance.

```prisma
model Product {
  id              String           @id
  name            String
  type            String
  importCode      String           @map("import_code")
  countryOfOrigin String           @map("country_of_origin")
  value           Float
  weight          Float
  unit            String
  transactions    Transaction[]
  checkerFindings CheckerFinding[]
  @@map("products")
}

model Transaction {
  id              String          @id
  date            DateTime
  importer        String
  broker          String
  portOfEntry     String          @map("port_of_entry")
  importCode      String          @map("import_code")
  countryOfOrigin String          @map("country_of_origin")
  units           Int
  unitValue       Float           @map("unit_value")
  totalValue      Float           @map("total_value")
  dutyDeclared    Float           @map("duty_declared")
  productId       String?         @map("product_id")
  product         Product?        @relation(fields: [productId], references: [id], onDelete: SetNull)
  checkerFinding  CheckerFinding?
  @@map("transactions")
}

model CheckerFinding {
  id            String      @id @default(uuid())
  dutyComputed  Float       @map("duty_computed")
  exposure      Float
  ruleId        String?     @map("rule_id")
  ruleName      String?     @map("rule_name")
  transactionId String      @unique @map("transaction_id")
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)
  productId     String?     @map("product_id")
  product       Product?    @relation(fields: [productId], references: [id], onDelete: SetNull)
  @@index([exposure(sort: Desc)])
  @@map("checker_findings")
}
```

## Ports

### `IDatabasePort` (output port)
```typescript
interface IDatabasePort {
  // Products
  getAllProducts(filters?: ProductFilters): Promise<PaginatedResult<Product>>;
  getProductById(id: string): Promise<Product | null>;
  updateProduct(id: string, data: Partial<Product>): Promise<Product>;

  // Transactions
  getAllTransactions(filters?: TransactionFilters): Promise<PaginatedResult<Transaction>>;
  getTransactionById(id: string): Promise<TransactionDetail | null>; // includes product + finding
  getTransactionsForProduct(productId: string): Promise<Transaction[]>;

  // Findings
  getFindings(filters?: FindingFilters): Promise<PaginatedResult<CheckerFinding>>;
  upsertFinding(finding: CheckerFindingInput): Promise<void>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;
}
```

### `ICheckerPort` (input port)
```typescript
interface ICheckerPort {
  // Run checker for a single transaction by ID (fetches, evaluates, persists finding)
  runForTransactionId(transactionId: string): Promise<void>;
  // Re-run checker for all transactions linked to a product
  runForProduct(productId: string): Promise<void>;
}
```

## Rule Engine (`CheckerEngine`)

First-match-wins sequential pipeline. If `transaction.productId` is non-null, the following master product fields override the declared transaction values **before** any rule is evaluated: `countryOfOrigin`, `importCode`, `type`, `value`.

| Priority | Rule ID | Name | Condition | Duty Formula |
|----------|---------|------|-----------|-------------|
| 1 | `R1` | Asian flat tariff | `countryOfOrigin` ∈ `{TW, CN}` | `$100` flat |
| 2 | `R2` | Russia high-volume surcharge | `countryOfOrigin === RU` **AND** `units >= 10` | `units × unit_value × 5%` |
| 3 | `R3` | EU consumables high-value duty | `countryOfOrigin` ∈ `{DE, FR, IT, ES, NL}` **AND** `type === consumable` **AND** `total_value > 1000` | `total_value × 15%` |
| — | — | default | no rule matched | `$0` |

`exposure = dutyComputed − dutyDeclared`

**Important notes:**
- R2 does **not** fire for fewer than 10 units (`units >= 10` is a hard threshold). A 9-unit Russian shipment returns $0.
- R3 uses the transaction's stored `total_value` — not a recomputed `units × unit_value`. Filing errors that produce mismatches are themselves a compliance signal.
- R3 requires **all three** conditions simultaneously: origin, type, and value threshold.
- NL (Netherlands) is a valid R3 origin alongside DE, FR, IT, ES.

The engine returns a plain `CheckerResult` object. No I/O. All rules are unit-testable without a database.

## API Endpoints

All routes are public (auth out of scope). Prefix: `/api/v1`.

---

### `GET /api/v1/dashboard/stats`

C-level ten-second scan. Aggregates over all `CheckerFinding` and `Transaction` rows.

**200 OK** response shape:
```json
{
  "data": {
    "totalExposure": 0,
    "totalDutyDeclared": 0,
    "totalDutyComputed": 0,
    "openFindingsCount": 0,
    "unmatchedTransactionsCount": 0,
    "topOffenders": {
      "byBroker":  [{ "name": "...", "totalExposure": 0 }],
      "byPort":    [{ "name": "...", "totalExposure": 0 }],
      "byProduct": [{ "id": "...", "name": "...", "totalExposure": 0 }]
    }
  }
}
```

Top-5 per dimension. Every number must be traceable to the underlying records via the other endpoints.

---

### `GET /api/v1/transactions`

Paginated list of all declared import events.

Query params: `page` (default 1), `per_page` (default 20), `status` (`matched` | `unmatched`), `broker`, `port_of_entry`

**200 OK** with `{ data: Transaction[], meta: { total, page, per_page, total_pages } }`

---

### `GET /api/v1/transactions/:id`

Single transaction detail. Includes linked product (if matched) and checker finding (if computed), plus the duty gap.

**200 OK** with:
```json
{
  "data": {
    "transaction": { ... },
    "product": { ... } | null,
    "finding": {
      "ruleId": "R1",
      "ruleName": "Asian flat tariff",
      "dutyDeclared": 0,
      "dutyComputed": 100,
      "exposure": 100
    } | null
  }
}
```
**404** if transaction not found.

---

### `GET /api/v1/products`

Paginated list of all products with open findings count per product.

Query params: `page` (default 1), `per_page` (default 20), `type`, `has_findings` (`true` | `false`)

**200 OK** with `{ data: ProductWithFindingsCount[], meta: { total, page, per_page, total_pages } }`

Each item includes `openFindingsCount: number`.

---

### `GET /api/v1/products/:id`

Single product detail with its linked transactions and active findings.

**200 OK** with:
```json
{
  "data": {
    "product": { ... },
    "transactions": [ ... ],
    "findings": [ ... ]
  }
}
```
**404** if product not found.

---

### `PATCH /api/v1/products/:id`

Partial update of a product record. After persisting, immediately re-runs `CheckerEngine` for all transactions linked to this product and upserts findings.

Request body: `UpdateProductDto` — any subset of `{ importCode, countryOfOrigin, type, value, weight, unit }` (all optional, non-whitelisted fields rejected by global `ValidationPipe`).

**200 OK** with `{ data: Product }`  
**404** if product not found  
**400 / 422** on validation failure

---

### `GET /api/v1/findings`

All checker findings ordered by `exposure DESC` (leverages native DB index). Paginated. Each finding includes transaction ID, product ID, rule that fired, declared duty, computed duty, and exposure gap.

Query params: `page` (default 1), `per_page` (default 50)

**200 OK** with `{ data: CheckerFinding[], meta: { total, page, per_page, total_pages } }`

---

## Data Seeding

`prisma/seed.ts` reads `/products.json` and `/transactions.json` from workspace root using Node `fs/promises`. Uses `upsert` for idempotency. Products are seeded first; transactions referencing unknown `product_id` values are inserted with `productId: null`.

After seeding, the seed script runs the CheckerEngine over **all** transactions to populate the `checker_findings` table on first boot.

## Swagger / OpenAPI

`@nestjs/swagger` generates the API spec automatically from decorators. Mounted at `GET /api/docs` (Swagger UI) and `GET /api/docs-json` (raw JSON spec).

**Setup in `main.ts`:**
```typescript
const config = new DocumentBuilder()
  .setTitle('TariffCorp API')
  .setDescription('Trade compliance platform — rule-checker, findings, products and transactions.')
  .setVersion('1.0')
  .addTag('dashboard')
  .addTag('transactions')
  .addTag('products')
  .addTag('findings')
  .build();

SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, config));
```

**Decorators used per controller:**
- `@ApiTags('<group>')` — groups endpoints in the UI
- `@ApiOperation({ summary, description })` — documents what each endpoint does
- `@ApiOkResponse` / `@ApiNotFoundResponse` / `@ApiBadRequestResponse` — documents response shapes
- DTOs decorated with `@ApiProperty` where needed for schema visibility

The `/api/docs-json` endpoint serves as the machine-readable contract for frontend codegen or import into tools like Postman/Insomnia.

## Validation & Error Handling

- Global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, `transform: true`.
- Global `HttpExceptionFilter` returning `{ error: { code, message, details? } }`.
- `no-explicit-any: error` in ESLint; Prettier with `singleQuote: true`.

## Testing

- Jest unit tests for `CheckerEngine` covering all rule branches, threshold boundary conditions, and the master-product override logic.
- Tests are isolated — no database, no NestJS context.
