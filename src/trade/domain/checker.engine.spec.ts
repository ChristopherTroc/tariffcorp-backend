import { NotFoundException } from '@nestjs/common';
import { CheckerEngine } from './checker.engine';
import { IDatabasePort } from '../ports/database-port.interface';
import {
  TransactionRecord,
  ProductRecord,
} from '../ports/database-port.interface';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTx(overrides: Partial<TransactionRecord> = {}): TransactionRecord {
  return {
    id: 'TX-TEST',
    date: new Date('2026-01-01'),
    importer: 'Test Importer',
    broker: 'Test Broker',
    portOfEntry: 'Los Angeles',
    importCode: '0000.00.00',
    countryOfOrigin: 'US',
    units: 1,
    unitValue: 100,
    totalValue: 100,
    dutyDeclared: 0,
    productId: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: 'P-TEST',
    name: 'Test Product',
    type: 'electronics',
    importCode: '0000.00.00',
    countryOfOrigin: 'US',
    value: 100,
    weight: 1,
    unit: 'kg',
    ...overrides,
  };
}

// Stub IDatabasePort — not used by evaluate() but required by constructor
const stubDb = {} as IDatabasePort;

describe('CheckerEngine.evaluate()', () => {
  let engine: CheckerEngine;

  beforeEach(() => {
    engine = new CheckerEngine(stubDb);
  });

  // ── R1 — Asian flat tariff ──────────────────────────────────────────────────

  describe('R1 — Asian flat tariff', () => {
    it('fires for CN origin → duty = $100', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'CN', units: 1, unitValue: 50 }),
        null,
      );
      expect(result.ruleId).toBe('R1');
      expect(result.dutyComputed).toBe(100);
    });

    it('fires for TW origin → duty = $100', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'TW', units: 1, unitValue: 50 }),
        null,
      );
      expect(result.ruleId).toBe('R1');
      expect(result.dutyComputed).toBe(100);
    });

    it('does NOT fire for VN origin', () => {
      const result = engine.evaluate(makeTx({ countryOfOrigin: 'VN' }), null);
      expect(result.ruleId).toBeNull();
      expect(result.dutyComputed).toBe(0);
    });
  });

  // ── R2 — Russia high-volume surcharge ──────────────────────────────────────

  describe('R2 — Russia high-volume surcharge', () => {
    it('fires for RU + 15 units + unit_value $50 → duty = $37.50', () => {
      const result = engine.evaluate(
        makeTx({
          countryOfOrigin: 'RU',
          units: 15,
          unitValue: 50,
          totalValue: 750,
        }),
        null,
      );
      expect(result.ruleId).toBe('R2');
      expect(result.dutyComputed).toBeCloseTo(37.5);
    });

    it('fires for RU + exactly 10 units + unit_value $50 → duty = $25', () => {
      const result = engine.evaluate(
        makeTx({
          countryOfOrigin: 'RU',
          units: 10,
          unitValue: 50,
          totalValue: 500,
        }),
        null,
      );
      expect(result.ruleId).toBe('R2');
      expect(result.dutyComputed).toBeCloseTo(25);
    });

    it('does NOT fire for RU + 9 units (below threshold)', () => {
      const result = engine.evaluate(
        makeTx({
          countryOfOrigin: 'RU',
          units: 9,
          unitValue: 50,
          totalValue: 450,
        }),
        null,
      );
      expect(result.ruleId).toBeNull();
      expect(result.dutyComputed).toBe(0);
    });
  });

  // ── R3 — EU consumables high-value duty ────────────────────────────────────

  describe('R3 — EU consumables high-value duty', () => {
    it('fires for DE + consumable + total_value $1200 → duty = $180', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'DE', totalValue: 1200 }),
        makeProduct({ type: 'consumable', countryOfOrigin: 'DE' }),
      );
      expect(result.ruleId).toBe('R3');
      expect(result.dutyComputed).toBeCloseTo(180);
    });

    it('fires for NL + consumable + total_value $2000 → duty = $300', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'NL', totalValue: 2000 }),
        makeProduct({ type: 'consumable', countryOfOrigin: 'NL' }),
      );
      expect(result.ruleId).toBe('R3');
      expect(result.dutyComputed).toBeCloseTo(300);
    });

    it('does NOT fire for DE + consumable + total_value $900 (below threshold)', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'DE', totalValue: 900 }),
        makeProduct({ type: 'consumable', countryOfOrigin: 'DE' }),
      );
      expect(result.ruleId).toBeNull();
      expect(result.dutyComputed).toBe(0);
    });

    it('does NOT fire for DE + electronics (wrong type)', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'DE', totalValue: 2000 }),
        makeProduct({ type: 'electronics', countryOfOrigin: 'DE' }),
      );
      expect(result.ruleId).toBeNull();
      expect(result.dutyComputed).toBe(0);
    });

    it('does NOT fire for US + consumable (wrong origin)', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'US', totalValue: 2000 }),
        makeProduct({ type: 'consumable', countryOfOrigin: 'US' }),
      );
      expect(result.ruleId).toBeNull();
      expect(result.dutyComputed).toBe(0);
    });
  });

  // ── Default ────────────────────────────────────────────────────────────────

  describe('default — no rule matches', () => {
    it('returns $0 duty when no rule applies', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'JP', units: 5, totalValue: 500 }),
        null,
      );
      expect(result.ruleId).toBeNull();
      expect(result.dutyComputed).toBe(0);
    });
  });

  // ── Master product override ────────────────────────────────────────────────

  describe('master product override', () => {
    it('overrides declared origin with product origin — R1 fires after override', () => {
      // Transaction declares US, but product says CN → R1 should fire
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'US', units: 1 }),
        makeProduct({ countryOfOrigin: 'CN' }),
      );
      expect(result.ruleId).toBe('R1');
      expect(result.dutyComputed).toBe(100);
    });

    it('overrides type with product type — R3 fires when product is consumable', () => {
      // Transaction has no type context, but product is consumable from DE
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'DE', totalValue: 1500 }),
        makeProduct({ countryOfOrigin: 'DE', type: 'consumable' }),
      );
      expect(result.ruleId).toBe('R3');
      expect(result.dutyComputed).toBeCloseTo(225);
    });

    it('overrides DE+consumable+$500 declared → RU product origin, 15 units → R2 fires', () => {
      const result = engine.evaluate(
        makeTx({
          countryOfOrigin: 'DE',
          totalValue: 500,
          units: 15,
          unitValue: 40,
        }),
        makeProduct({ countryOfOrigin: 'RU', type: 'consumable' }),
      );
      expect(result.ruleId).toBe('R2');
      expect(result.dutyComputed).toBeCloseTo(15 * 40 * 0.05); // 30
    });
  });

  // ── Exposure calculation ───────────────────────────────────────────────────

  describe('exposure calculation', () => {
    it('exposure = dutyComputed − dutyDeclared (positive)', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'CN', dutyDeclared: 30 }),
        null,
      );
      expect(result.dutyComputed).toBe(100);
      expect(result.exposure).toBeCloseTo(70); // 100 - 30
    });

    it('exposure can be negative when declared > computed', () => {
      const result = engine.evaluate(
        makeTx({ countryOfOrigin: 'JP', dutyDeclared: 50, totalValue: 100 }),
        null,
      );
      expect(result.dutyComputed).toBe(0);
      expect(result.exposure).toBeCloseTo(-50); // 0 - 50
    });
  });
});

describe('CheckerEngine.runForTransactionId / runForProduct', () => {
  const upsertFinding = jest.fn().mockResolvedValue(undefined);
  const getTransactionById = jest.fn();
  const getTransactionsForProduct = jest.fn();

  const db = {
    upsertFinding,
    getTransactionById,
    getTransactionsForProduct,
  } as unknown as IDatabasePort;

  let engine: CheckerEngine;

  beforeEach(() => {
    jest.clearAllMocks();
    engine = new CheckerEngine(db);
  });

  it('evaluates and upserts a finding for a transaction', async () => {
    getTransactionById.mockResolvedValue({
      transaction: makeTx({
        id: 'TX-1',
        countryOfOrigin: 'CN',
        dutyDeclared: 0,
      }),
      product: null,
      finding: null,
    });

    await engine.runForTransactionId('TX-1');
    expect(upsertFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId: 'TX-1',
        ruleId: 'R1',
        dutyComputed: 100,
        exposure: 100,
      }),
    );
  });

  it('throws NotFoundException when transaction is missing', async () => {
    getTransactionById.mockResolvedValue(null);
    await expect(engine.runForTransactionId('TX-X')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('re-runs checker for every linked transaction', async () => {
    getTransactionsForProduct.mockResolvedValue([
      makeTx({ id: 'TX-1' }),
      makeTx({ id: 'TX-2' }),
    ]);
    getTransactionById.mockImplementation((id: string) =>
      Promise.resolve({
        transaction: makeTx({ id, countryOfOrigin: 'CN' }),
        product: null,
        finding: null,
      }),
    );

    await engine.runForProduct('P-1');
    expect(getTransactionsForProduct).toHaveBeenCalledWith('P-1');
    expect(upsertFinding).toHaveBeenCalledTimes(2);
  });
});
