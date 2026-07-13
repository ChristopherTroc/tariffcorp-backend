# TariffCorp — Backend API

REST API for the TariffCorp trade compliance platform. Built with NestJS, Prisma, and Supabase PostgreSQL.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Create environment file
cp .env.example .env
# Fill in DATABASE_URL and DIRECT_URL with your Supabase credentials

# 3. Run migrations
npx prisma migrate dev

# 4. Seed data (products + transactions + initial findings)
npx prisma db seed

# 5. Start in development mode
npm run start:dev
```

The API will be available at `http://localhost:3001/api/v1`.  
Swagger UI: `http://localhost:3001/api/docs`

---

## Environment Variables

Create a `.env` file in the project root:

```env
# Transaction pooler — used by the app at runtime (pgbouncer)
DATABASE_URL="postgresql://postgres.[project-ref]:[PASSWORD]@aws-1-us-west-2.pooler.supabase.com:6543/postgres?pgbouncer=true"

# Session pooler / direct URL — used by Prisma Migrate and the seed script
DIRECT_URL="postgresql://postgres.[project-ref]:[PASSWORD]@aws-1-us-west-2.pooler.supabase.com:5432/postgres"

PORT=3001
```

> **Password with special characters:** URL-encode them before placing in the connection string.  
> `#` → `%23` · `,` → `%2C` · `?` → `%3F`

---

## API Endpoints

All routes are prefixed with `/api/v1`. Authentication is out of scope — all endpoints are public.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/dashboard/stats` | C-level rollups: total exposure, duty declared vs. owed, open findings count, top-5 offenders by broker/port/product |
| `GET` | `/transactions` | Paginated list. Filters: `status` (matched\|unmatched), `broker`, `port_of_entry` |
| `GET` | `/transactions/:id` | Transaction detail with linked product and checker finding |
| `GET` | `/products` | Paginated catalog. Each item includes `openFindingsCount`. Filters: `type`, `has_findings` |
| `GET` | `/products/:id` | Product detail with linked transactions and findings |
| `PATCH` | `/products/:id` | Update product fields. Triggers immediate re-evaluation of the checker for all linked transactions |
| `GET` | `/findings` | All checker findings, ordered by `exposure DESC`. Paginated |

Full interactive documentation: **`GET /api/docs`** (Swagger UI)  
Machine-readable spec: **`GET /api/docs-json`** (OpenAPI JSON)

---

## Architecture

Lightweight **Hexagonal (Ports & Adapters)** pattern inside a single `TradeModule`. Domain logic is framework-free; NestJS infrastructure wires it together.

```
src/
├── app.module.ts
├── main.ts                            # Bootstrap: pipe, filter, CORS, Swagger
└── trade/
    ├── trade.module.ts
    ├── domain/
    │   └── checker.engine.ts          # Pure TS rule engine — no NestJS or Prisma imports
    ├── ports/
    │   ├── database-port.interface.ts # IDatabasePort (output port)
    │   └── checker-port.interface.ts  # ICheckerPort  (input port)
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

**Why hexagonal?**  
The `CheckerEngine` has zero imports from `@nestjs/*` or `@prisma/*`. It receives an `IDatabasePort` via constructor injection, making it unit-testable in complete isolation — no database, no HTTP context required.

---

## Rule Engine

First-match-wins sequential pipeline. When a transaction has a `productId`, the master product's fields (`countryOfOrigin`, `importCode`, `type`, `value`) override the declared values before any rule is evaluated.

| Priority | ID | Name | Condition | Formula |
|----------|----|------|-----------|---------|
| 1 | R1 | Asian flat tariff | `countryOfOrigin` ∈ `{TW, CN}` | `$100` flat |
| 2 | R2 | Russia high-volume surcharge | `countryOfOrigin === RU` AND `units >= 10` | `units × unit_value × 5%` |
| 3 | R3 | EU consumables high-value duty | `countryOfOrigin` ∈ `{DE, FR, IT, ES, NL}` AND `type === consumable` AND `total_value > $1,000` | `total_value × 15%` |
| — | — | Default | no rule matched | `$0` |

`exposure = dutyComputed − dutyDeclared`

**Key decisions:**
- R2 threshold is `units >= 10` — a 9-unit Russian shipment produces $0 duty
- R3 uses the transaction's stored `total_value`, not a recomputed `units × unit_value`. Filing mismatches between these two values are themselves a compliance signal
- Editing a product via `PATCH /products/:id` immediately re-runs the engine for every linked transaction and upserts findings — one fix propagates to all past records

---

## Database

**Supabase PostgreSQL** via **Prisma ORM**.

Three models: `products`, `transactions`, `checker_findings`.

`checker_findings` has a native `@@index([exposure(sort: Desc)])` so the findings endpoint leverages the DB index directly without application-side sorting.

The schema uses two connection URLs:
- `DATABASE_URL` — transaction pooler (pgbouncer, port 6543) for runtime queries
- `DIRECT_URL` — session pooler (port 5432) for `prisma migrate` and the seed script

---

## Key Decisions

**NestJS over Express/Fastify directly**  
Decorator-based DI makes the hexagonal port wiring explicit and readable. `@Inject(DATABASE_PORT)` with a Symbol token enforces the boundary at the framework level.

**Prisma v5 over v7**  
Prisma v7 moved connection URLs out of `schema.prisma` into a separate `prisma.config.ts` file. v5 is the stable, widely-documented version that matches the familiar `url = env("DATABASE_URL")` pattern.

**Batch inserts in seed over sequential upserts**  
The transaction pooler (pgbouncer) doesn't support Prisma's prepared statement protocol for sequential upserts at scale. The seed uses `createMany` with the `DIRECT_URL` to avoid timeouts.

**Symbol injection tokens over string tokens**  
`DATABASE_PORT = Symbol('IDatabasePort')` avoids collision and is tree-shakeable. Interfaces are imported as `import type` to satisfy `isolatedModules` + `emitDecoratorMetadata`.

---

## Tests

```bash
# Unit tests (CheckerEngine — no DB required)
npm test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov
```

17 unit tests cover all rule branches, boundary conditions (R2 threshold at 9 vs. 10 units), negative cases, master-product override logic, and exposure sign correctness.

---

## Known Limitations

- `PATCH /products/:id` does not support reassigning `productId` on a transaction — that would require a separate endpoint
- No pagination on `GET /products/:id` sub-arrays (transactions and findings returned in full)
- Dashboard aggregates are computed on every request — no caching layer yet
- The seed script uses `deleteMany` + `createMany` (truncate-and-reload), not idempotent upserts, to work around pgbouncer constraints

---

## AI Usage

Scaffolding, boilerplate, and the majority of implementation were generated with AI assistance (Kilo / Claude).

Files with significant AI contribution:
- `prisma/schema.prisma` — generated from spec, verified against challenge requirements
- `src/trade/domain/checker.engine.ts` — rule logic reviewed and validated against all 3 rule definitions in the challenge PDF
- `src/trade/infrastructure/adapters/prisma-trade.adapter.ts` — Prisma query patterns generated, dashboard aggregation logic reviewed for correctness
- `src/trade/domain/checker.engine.spec.ts` — all 17 test cases authored to match challenge spec; each case was manually traced against the rule definitions
- `prisma/seed.ts` — path resolution and batch insert strategy required manual debugging to resolve pgbouncer compatibility

All AI-generated code was reviewed for correctness against the challenge spec. The rule engine logic (countries, thresholds, formulas) was cross-checked line by line against the challenge PDF before acceptance.
