# Proposal: TariffCorp Platform Core

## What

Build a single-tenant trade compliance REST API using NestJS and Prisma on Supabase PostgreSQL. The platform ingests two source datasets (`products.json`, `transactions.json`), runs them through a deterministic tariff rule-checker engine, and exposes REST endpoints for: a financial dashboard, a transaction list with drill-down detail, a product catalog with detail and edit, and a checker findings ledger.

## Why

Trade managers need to identify and correct catalog misclassifications that generate the highest downstream dollar exposure. Without a system that automatically cross-references declared customs data against a master product catalog and applies tariff rules, analysts must reconcile data manually — a slow, error-prone process that delays financial prioritization decisions.

The core business value is ordering compliance discrepancies by **exposure descending** (duty computed − duty declared), so the highest-leverage corrections surface first. Fixing one product record propagates retroactively to every transaction that references it — this is the primary correction action the platform must make fast and obvious.

A note on filing errors: `total_value` on a transaction is what was declared, and it does not always equal `units × unit_value`. This mismatch is itself a signal. Rule 3 (EU consumables) intentionally uses the stored `total_value`, not a recomputed one.

## Goals

- Ingest `products.json` and `transactions.json` datasets into Supabase via an idempotent seed script.
- Execute a first-match-wins tariff rule pipeline (R1 → R2 → R3 → default $0) that overrides declared fields with master product values before evaluation.
- Persist `CheckerFinding` records per transaction: winning rule ID/name, computed duty, and exposure gap.
- Expose REST endpoints for:
  - Dashboard rollups (total exposure, duty declared vs. owed, open findings count, top offenders by broker/port/product)
  - Transaction list with pagination and filters; single transaction detail with linked product and finding
  - Product list with open findings count per product; single product detail with linked transactions and findings; PATCH with cascading re-evaluation
  - Findings ledger ordered by exposure DESC with pagination
- Ship a Swagger UI (`GET /api/docs`) auto-generated from `@nestjs/swagger` decorators, serving as the living API contract for frontend integration.

## Non-Goals

- Authentication and authorization (explicitly out of scope).
- Multi-tenant isolation.
- Real-time streaming or webhooks.
- Frontend UI (separate deliverable).
- Swagger auth/security schemes (all endpoints are public).

## Risks

| Risk | Mitigation |
|------|-----------|
| Transactions referencing unknown product IDs | Seed script maps missing product relations to `null`; unmatched transactions are surfaced, not hidden |
| Rule logic errors (wrong countries or thresholds) | Pure domain `CheckerEngine` with isolated Jest unit tests covering all rule branches, thresholds, and negative cases explicitly |
| PATCH re-evaluation performance | Scoped re-evaluation: only re-run transactions linked to the updated product ID, not the full dataset |
| `total_value` filing errors (≠ `units × unit_value`) | Rule 3 threshold and formula use the transaction's stored `total_value` as-is |
