import { NotFoundException } from '@nestjs/common';
import {
  IDatabasePort,
  CheckerFindingInput,
  TransactionRecord,
  ProductRecord,
} from '../ports/database-port.interface';
import { ICheckerPort } from '../ports/checker-port.interface';

export interface CheckerResult {
  ruleId: string | null;
  ruleName: string | null;
  dutyComputed: number;
  exposure: number;
}

const R1_COUNTRIES = new Set(['TW', 'CN']);
const R2_COUNTRY = 'RU';
const R2_UNITS_MIN = 10;
const R3_COUNTRIES = new Set(['DE', 'FR', 'IT', 'ES', 'NL']);
const R3_TYPE = 'consumable';
const R3_VALUE_MIN = 1000;

/**
 * Pure domain rule engine — no Prisma or framework I/O.
 * Implements ICheckerPort when injected with an IDatabasePort.
 */
export class CheckerEngine implements ICheckerPort {
  constructor(private readonly db: IDatabasePort) {}

  /**
   * Evaluate tariff rules for a single transaction.
   * Accepts already-resolved objects so this function is testable without I/O.
   */
  evaluate(
    tx: TransactionRecord,
    product: ProductRecord | null,
  ): CheckerResult {
    // Override declared fields with master product values when matched
    const countryOfOrigin = product?.countryOfOrigin ?? tx.countryOfOrigin;
    const type = product?.type ?? null;
    const unitValue = tx.unitValue;
    const totalValue = tx.totalValue;
    const units = tx.units;
    const dutyDeclared = tx.dutyDeclared;

    let dutyComputed = 0;
    let ruleId: string | null = null;
    let ruleName: string | null = null;

    if (R1_COUNTRIES.has(countryOfOrigin)) {
      // R1 — Asian flat tariff: TW or CN → $100 flat
      dutyComputed = 100;
      ruleId = 'R1';
      ruleName = 'Asian flat tariff';
    } else if (countryOfOrigin === R2_COUNTRY && units >= R2_UNITS_MIN) {
      // R2 — Russia high-volume surcharge: RU + >= 10 units → units × unit_value × 5%
      dutyComputed = units * unitValue * 0.05;
      ruleId = 'R2';
      ruleName = 'Russia high-volume surcharge';
    } else if (
      R3_COUNTRIES.has(countryOfOrigin) &&
      type === R3_TYPE &&
      totalValue > R3_VALUE_MIN
    ) {
      // R3 — EU consumables high-value duty: EU + consumable + total_value > $1000 → total_value × 15%
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

  /** Fetch transaction by ID, evaluate, persist finding. */
  async runForTransactionId(transactionId: string): Promise<void> {
    const detail = await this.db.getTransactionById(transactionId);
    if (!detail) {
      throw new NotFoundException(`Transaction ${transactionId} not found`);
    }

    const { transaction, product } = detail;
    const result = this.evaluate(transaction, product);

    const finding: CheckerFindingInput = {
      transactionId: transaction.id,
      productId: transaction.productId,
      ruleId: result.ruleId,
      ruleName: result.ruleName,
      dutyComputed: result.dutyComputed,
      exposure: result.exposure,
    };

    await this.db.upsertFinding(finding);
  }

  /** Re-run checker for every transaction linked to this product. */
  async runForProduct(productId: string): Promise<void> {
    const transactions = await this.db.getTransactionsForProduct(productId);
    await Promise.all(
      transactions.map((tx) => this.runForTransactionId(tx.id)),
    );
  }
}
