import { PrismaTradeAdapter } from './prisma-trade.adapter';
import type { PrismaService } from './prisma.service';

const productRow = {
  id: 'P-1',
  name: 'Widget',
  type: 'electronics',
  importCode: '1234.00.00',
  countryOfOrigin: 'CN',
  value: 100,
  weight: 2,
  unit: 'kg',
  _count: { checkerFindings: 2 },
};

const txRow = {
  id: 'TX-1',
  date: new Date('2026-01-01'),
  importer: 'Acme',
  broker: 'Beacon Trade Group',
  portOfEntry: 'Los Angeles',
  importCode: '1234.00.00',
  countryOfOrigin: 'CN',
  units: 5,
  unitValue: 20,
  totalValue: 100,
  dutyDeclared: 10,
  productId: 'P-1',
};

const findingRow = {
  id: 'F-1',
  dutyComputed: 100,
  exposure: 90,
  ruleId: 'R1',
  ruleName: 'Asian flat tariff',
  transactionId: 'TX-1',
  productId: 'P-1',
};

describe('PrismaTradeAdapter', () => {
  let prisma: {
    product: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    transaction: {
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      aggregate: jest.Mock;
    };
    checkerFinding: {
      findMany: jest.Mock;
      count: jest.Mock;
      upsert: jest.Mock;
      aggregate: jest.Mock;
      groupBy: jest.Mock;
    };
  };
  let adapter: PrismaTradeAdapter;

  beforeEach(() => {
    prisma = {
      product: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      transaction: {
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        aggregate: jest.fn(),
      },
      checkerFinding: {
        findMany: jest.fn(),
        count: jest.fn(),
        upsert: jest.fn(),
        aggregate: jest.fn(),
        groupBy: jest.fn(),
      },
    };
    adapter = new PrismaTradeAdapter(prisma as unknown as PrismaService);
  });

  describe('getAllProducts', () => {
    it('maps openFindingsCount and filters by type + has_findings', async () => {
      prisma.product.findMany.mockResolvedValue([productRow]);
      prisma.product.count.mockResolvedValue(1);

      const result = await adapter.getAllProducts({
        page: 1,
        per_page: 10,
        type: 'electronics',
        has_findings: true,
      });

      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            type: 'electronics',
            checkerFindings: { some: {} },
          },
        }),
      );
      expect(result.data[0].openFindingsCount).toBe(2);
      expect(result.meta).toEqual({
        total: 1,
        page: 1,
        per_page: 10,
        total_pages: 1,
      });
    });

    it('filters has_findings=false with none', async () => {
      prisma.product.findMany.mockResolvedValue([]);
      prisma.product.count.mockResolvedValue(0);

      await adapter.getAllProducts({ has_findings: false });
      expect(prisma.product.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { checkerFindings: { none: {} } },
        }),
      );
    });
  });

  describe('getProductById', () => {
    it('returns null when missing', async () => {
      prisma.product.findUnique.mockResolvedValue(null);
      await expect(adapter.getProductById('P-X')).resolves.toBeNull();
    });

    it('maps product, transactions, and findings', async () => {
      prisma.product.findUnique.mockResolvedValue({
        ...productRow,
        transactions: [txRow],
        checkerFindings: [findingRow],
      });

      const detail = await adapter.getProductById('P-1');
      expect(detail?.product.id).toBe('P-1');
      expect(detail?.transactions).toHaveLength(1);
      expect(detail?.findings[0].ruleId).toBe('R1');
    });
  });

  describe('updateProduct', () => {
    it('updates provided fields only', async () => {
      prisma.product.update.mockResolvedValue({
        ...productRow,
        countryOfOrigin: 'TW',
      });

      const updated = await adapter.updateProduct('P-1', {
        countryOfOrigin: 'TW',
      });
      expect(updated.countryOfOrigin).toBe('TW');
      expect(prisma.product.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { countryOfOrigin: 'TW' },
        }),
      );
    });
  });

  describe('getAllTransactions', () => {
    it('applies matched/unmatched and text filters', async () => {
      prisma.transaction.findMany.mockResolvedValue([txRow]);
      prisma.transaction.count.mockResolvedValue(1);

      await adapter.getAllTransactions({
        status: 'matched',
        broker: 'Beacon',
        port_of_entry: 'Los',
      });
      expect(prisma.transaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            productId: { not: null },
            broker: { contains: 'Beacon', mode: 'insensitive' },
            portOfEntry: { contains: 'Los', mode: 'insensitive' },
          },
        }),
      );

      await adapter.getAllTransactions({ status: 'unmatched' });
      expect(prisma.transaction.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { productId: null },
        }),
      );
    });
  });

  describe('getTransactionById', () => {
    it('returns null when missing', async () => {
      prisma.transaction.findUnique.mockResolvedValue(null);
      await expect(adapter.getTransactionById('TX-X')).resolves.toBeNull();
    });

    it('maps product and finding when present', async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        ...txRow,
        product: productRow,
        checkerFinding: findingRow,
      });
      const detail = await adapter.getTransactionById('TX-1');
      expect(detail?.product?.id).toBe('P-1');
      expect(detail?.finding?.id).toBe('F-1');
    });

    it('maps null product and finding', async () => {
      prisma.transaction.findUnique.mockResolvedValue({
        ...txRow,
        product: null,
        checkerFinding: null,
      });
      const detail = await adapter.getTransactionById('TX-1');
      expect(detail?.product).toBeNull();
      expect(detail?.finding).toBeNull();
    });
  });

  describe('getTransactionsForProduct', () => {
    it('returns mapped transactions', async () => {
      prisma.transaction.findMany.mockResolvedValue([txRow]);
      const rows = await adapter.getTransactionsForProduct('P-1');
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe('TX-1');
    });
  });

  describe('getFindings / upsertFinding', () => {
    it('lists findings ordered by exposure', async () => {
      prisma.checkerFinding.findMany.mockResolvedValue([findingRow]);
      prisma.checkerFinding.count.mockResolvedValue(1);
      const result = await adapter.getFindings({ page: 1, per_page: 50 });
      expect(result.data[0].exposure).toBe(90);
      expect(result.meta.total).toBe(1);
    });

    it('upserts a finding', async () => {
      prisma.checkerFinding.upsert.mockResolvedValue(findingRow);
      await adapter.upsertFinding({
        transactionId: 'TX-1',
        productId: 'P-1',
        ruleId: 'R1',
        ruleName: 'Asian flat tariff',
        dutyComputed: 100,
        exposure: 90,
      });
      expect(prisma.checkerFinding.upsert).toHaveBeenCalled();
    });
  });

  describe('getDashboardStats', () => {
    it('aggregates exposure and top offenders', async () => {
      prisma.checkerFinding.aggregate.mockResolvedValue({
        _sum: { exposure: 200, dutyComputed: 300 },
      });
      prisma.transaction.aggregate.mockResolvedValue({
        _sum: { dutyDeclared: 100 },
      });
      prisma.transaction.count.mockResolvedValue(2);
      prisma.checkerFinding.count.mockResolvedValue(5);
      prisma.checkerFinding.groupBy.mockResolvedValue([]);
      prisma.checkerFinding.findMany.mockResolvedValue([
        {
          exposure: 150,
          productId: 'P-1',
          transaction: { broker: 'Beacon', portOfEntry: 'LAX' },
          product: { id: 'P-1', name: 'Widget' },
        },
        {
          exposure: 50,
          productId: 'P-1',
          transaction: { broker: 'Beacon', portOfEntry: 'JFK' },
          product: { id: 'P-1', name: 'Widget' },
        },
        {
          exposure: 10,
          productId: null,
          transaction: { broker: 'Other', portOfEntry: 'LAX' },
          product: null,
        },
      ]);

      const stats = await adapter.getDashboardStats();
      expect(stats.totalExposure).toBe(200);
      expect(stats.totalDutyDeclared).toBe(100);
      expect(stats.totalDutyComputed).toBe(300);
      expect(stats.openFindingsCount).toBe(5);
      expect(stats.unmatchedTransactionsCount).toBe(2);
      expect(stats.topOffenders.byBroker[0]).toEqual({
        name: 'Beacon',
        totalExposure: 200,
      });
      expect(stats.topOffenders.byPort[0].name).toBe('LAX');
      expect(stats.topOffenders.byProduct[0]).toEqual({
        id: 'P-1',
        name: 'Widget',
        totalExposure: 200,
      });
    });

    it('defaults aggregate sums to 0 when null', async () => {
      prisma.checkerFinding.aggregate.mockResolvedValue({
        _sum: { exposure: null, dutyComputed: null },
      });
      prisma.transaction.aggregate.mockResolvedValue({
        _sum: { dutyDeclared: null },
      });
      prisma.transaction.count.mockResolvedValue(0);
      prisma.checkerFinding.count.mockResolvedValue(0);
      prisma.checkerFinding.groupBy.mockResolvedValue([]);
      prisma.checkerFinding.findMany.mockResolvedValue([]);

      const stats = await adapter.getDashboardStats();
      expect(stats.totalExposure).toBe(0);
      expect(stats.totalDutyDeclared).toBe(0);
      expect(stats.totalDutyComputed).toBe(0);
    });
  });
});
