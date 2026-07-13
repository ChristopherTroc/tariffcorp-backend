import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import {
  IDatabasePort,
  ProductFilters,
  TransactionFilters,
  FindingFilters,
  CheckerFindingInput,
  PaginatedResult,
  ProductWithCount,
  ProductRecord,
  TransactionRecord,
  FindingRecord,
  TransactionDetail,
  ProductDetail,
  DashboardStats,
} from '../../ports/database-port.interface';

function paginate(page = 1, per_page = 20): { skip: number; take: number } {
  return { skip: (page - 1) * per_page, take: per_page };
}

function makeMeta(
  total: number,
  page: number,
  per_page: number,
): PaginatedResult<never>['meta'] {
  return {
    total,
    page,
    per_page,
    total_pages: Math.ceil(total / per_page),
  };
}

@Injectable()
export class PrismaTradeAdapter implements IDatabasePort {
  constructor(private readonly prisma: PrismaService) {}

  // ── Products ────────────────────────────────────────────────────────────────

  async getAllProducts(
    filters: ProductFilters = {},
  ): Promise<PaginatedResult<ProductWithCount>> {
    const { page = 1, per_page = 20, type, has_findings } = filters;
    const { skip, take } = paginate(page, per_page);

    const where: Record<string, unknown> = {};
    if (type) where['type'] = type;
    if (has_findings === true) {
      where['checkerFindings'] = { some: {} };
    } else if (has_findings === false) {
      where['checkerFindings'] = { none: {} };
    }

    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        skip,
        take,
        include: { _count: { select: { checkerFindings: true } } },
        orderBy: { id: 'asc' },
      }),
      this.prisma.product.count({ where }),
    ]);

    const data: ProductWithCount[] = items.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      importCode: p.importCode,
      countryOfOrigin: p.countryOfOrigin,
      value: p.value,
      weight: p.weight,
      unit: p.unit,
      openFindingsCount: p._count.checkerFindings,
    }));

    return { data, meta: makeMeta(total, page, per_page) };
  }

  async getProductById(id: string): Promise<ProductDetail | null> {
    const p = await this.prisma.product.findUnique({
      where: { id },
      include: {
        transactions: true,
        checkerFindings: { orderBy: { exposure: 'desc' } },
      },
    });
    if (!p) return null;

    const product: ProductRecord = {
      id: p.id,
      name: p.name,
      type: p.type,
      importCode: p.importCode,
      countryOfOrigin: p.countryOfOrigin,
      value: p.value,
      weight: p.weight,
      unit: p.unit,
    };

    const transactions: TransactionRecord[] = p.transactions.map((t) => ({
      id: t.id,
      date: t.date,
      importer: t.importer,
      broker: t.broker,
      portOfEntry: t.portOfEntry,
      importCode: t.importCode,
      countryOfOrigin: t.countryOfOrigin,
      units: t.units,
      unitValue: t.unitValue,
      totalValue: t.totalValue,
      dutyDeclared: t.dutyDeclared,
      productId: t.productId,
    }));

    const findings: FindingRecord[] = p.checkerFindings.map((f) => ({
      id: f.id,
      dutyComputed: f.dutyComputed,
      exposure: f.exposure,
      ruleId: f.ruleId,
      ruleName: f.ruleName,
      transactionId: f.transactionId,
      productId: f.productId,
    }));

    return { product, transactions, findings };
  }

  async updateProduct(
    id: string,
    data: Partial<ProductRecord>,
  ): Promise<ProductRecord> {
    const p = await this.prisma.product.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.importCode !== undefined && { importCode: data.importCode }),
        ...(data.countryOfOrigin !== undefined && {
          countryOfOrigin: data.countryOfOrigin,
        }),
        ...(data.value !== undefined && { value: data.value }),
        ...(data.weight !== undefined && { weight: data.weight }),
        ...(data.unit !== undefined && { unit: data.unit }),
      },
    });
    return {
      id: p.id,
      name: p.name,
      type: p.type,
      importCode: p.importCode,
      countryOfOrigin: p.countryOfOrigin,
      value: p.value,
      weight: p.weight,
      unit: p.unit,
    };
  }

  // ── Transactions ────────────────────────────────────────────────────────────

  async getAllTransactions(
    filters: TransactionFilters = {},
  ): Promise<PaginatedResult<TransactionRecord>> {
    const { page = 1, per_page = 20, status, broker, port_of_entry } = filters;
    const { skip, take } = paginate(page, per_page);

    const where: Record<string, unknown> = {};
    if (status === 'matched') where['productId'] = { not: null };
    if (status === 'unmatched') where['productId'] = null;
    if (broker) where['broker'] = { contains: broker, mode: 'insensitive' };
    if (port_of_entry) where['portOfEntry'] = { contains: port_of_entry, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.transaction.findMany({
        where,
        skip,
        take,
        orderBy: { date: 'desc' },
      }),
      this.prisma.transaction.count({ where }),
    ]);

    const data: TransactionRecord[] = items.map((t) => ({
      id: t.id,
      date: t.date,
      importer: t.importer,
      broker: t.broker,
      portOfEntry: t.portOfEntry,
      importCode: t.importCode,
      countryOfOrigin: t.countryOfOrigin,
      units: t.units,
      unitValue: t.unitValue,
      totalValue: t.totalValue,
      dutyDeclared: t.dutyDeclared,
      productId: t.productId,
    }));

    return { data, meta: makeMeta(total, page, per_page) };
  }

  async getTransactionById(id: string): Promise<TransactionDetail | null> {
    const t = await this.prisma.transaction.findUnique({
      where: { id },
      include: { product: true, checkerFinding: true },
    });
    if (!t) return null;

    const transaction: TransactionRecord = {
      id: t.id,
      date: t.date,
      importer: t.importer,
      broker: t.broker,
      portOfEntry: t.portOfEntry,
      importCode: t.importCode,
      countryOfOrigin: t.countryOfOrigin,
      units: t.units,
      unitValue: t.unitValue,
      totalValue: t.totalValue,
      dutyDeclared: t.dutyDeclared,
      productId: t.productId,
    };

    const product: ProductRecord | null = t.product
      ? {
          id: t.product.id,
          name: t.product.name,
          type: t.product.type,
          importCode: t.product.importCode,
          countryOfOrigin: t.product.countryOfOrigin,
          value: t.product.value,
          weight: t.product.weight,
          unit: t.product.unit,
        }
      : null;

    const finding: FindingRecord | null = t.checkerFinding
      ? {
          id: t.checkerFinding.id,
          dutyComputed: t.checkerFinding.dutyComputed,
          exposure: t.checkerFinding.exposure,
          ruleId: t.checkerFinding.ruleId,
          ruleName: t.checkerFinding.ruleName,
          transactionId: t.checkerFinding.transactionId,
          productId: t.checkerFinding.productId,
        }
      : null;

    return { transaction, product, finding };
  }

  async getTransactionsForProduct(
    productId: string,
  ): Promise<TransactionRecord[]> {
    const items = await this.prisma.transaction.findMany({
      where: { productId },
    });
    return items.map((t) => ({
      id: t.id,
      date: t.date,
      importer: t.importer,
      broker: t.broker,
      portOfEntry: t.portOfEntry,
      importCode: t.importCode,
      countryOfOrigin: t.countryOfOrigin,
      units: t.units,
      unitValue: t.unitValue,
      totalValue: t.totalValue,
      dutyDeclared: t.dutyDeclared,
      productId: t.productId,
    }));
  }

  // ── Findings ────────────────────────────────────────────────────────────────

  async getFindings(
    filters: FindingFilters = {},
  ): Promise<PaginatedResult<FindingRecord>> {
    const { page = 1, per_page = 50 } = filters;
    const { skip, take } = paginate(page, per_page);

    const [items, total] = await Promise.all([
      this.prisma.checkerFinding.findMany({
        skip,
        take,
        orderBy: { exposure: 'desc' },
      }),
      this.prisma.checkerFinding.count(),
    ]);

    const data: FindingRecord[] = items.map((f) => ({
      id: f.id,
      dutyComputed: f.dutyComputed,
      exposure: f.exposure,
      ruleId: f.ruleId,
      ruleName: f.ruleName,
      transactionId: f.transactionId,
      productId: f.productId,
    }));

    return { data, meta: makeMeta(total, page, per_page) };
  }

  async upsertFinding(finding: CheckerFindingInput): Promise<void> {
    await this.prisma.checkerFinding.upsert({
      where: { transactionId: finding.transactionId },
      update: {
        dutyComputed: finding.dutyComputed,
        exposure: finding.exposure,
        ruleId: finding.ruleId,
        ruleName: finding.ruleName,
        productId: finding.productId,
      },
      create: {
        transactionId: finding.transactionId,
        dutyComputed: finding.dutyComputed,
        exposure: finding.exposure,
        ruleId: finding.ruleId,
        ruleName: finding.ruleName,
        productId: finding.productId,
      },
    });
  }

  // ── Dashboard ────────────────────────────────────────────────────────────────

  async getDashboardStats(): Promise<DashboardStats> {
    const [
      findingAggregates,
      txAggregates,
      unmatchedCount,
      openFindingsCount,
      brokerGroups,
      portGroups,
    ] = await Promise.all([
      this.prisma.checkerFinding.aggregate({
        _sum: { exposure: true, dutyComputed: true },
      }),
      this.prisma.transaction.aggregate({
        _sum: { dutyDeclared: true },
      }),
      this.prisma.transaction.count({ where: { productId: null } }),
      this.prisma.checkerFinding.count(),
      // Top 5 brokers by total exposure — via raw groupBy on transactions join
      this.prisma.checkerFinding.groupBy({
        by: ['transactionId'],
        _sum: { exposure: true },
      }),
      this.prisma.checkerFinding.groupBy({
        by: ['transactionId'],
        _sum: { exposure: true },
      }),
    ]);

    // For broker/port top-5 we need to join through transactions.
    // Prisma groupBy doesn't support join grouping, so we pull the data in two steps.
    const allFindings = await this.prisma.checkerFinding.findMany({
      select: {
        exposure: true,
        productId: true,
        transaction: { select: { broker: true, portOfEntry: true } },
        product: { select: { id: true, name: true } },
      },
    });

    // Aggregate by broker
    const brokerMap = new Map<string, number>();
    const portMap = new Map<string, number>();
    const productMap = new Map<string, { name: string; total: number }>();

    for (const f of allFindings) {
      const broker = f.transaction.broker;
      const port = f.transaction.portOfEntry;
      brokerMap.set(broker, (brokerMap.get(broker) ?? 0) + f.exposure);
      portMap.set(port, (portMap.get(port) ?? 0) + f.exposure);

      if (f.productId && f.product) {
        const existing = productMap.get(f.productId);
        productMap.set(f.productId, {
          name: f.product.name,
          total: (existing?.total ?? 0) + f.exposure,
        });
      }
    }

    const top5 = <T extends { totalExposure: number }>(arr: T[]): T[] =>
      arr.sort((a, b) => b.totalExposure - a.totalExposure).slice(0, 5);

    return {
      totalExposure: findingAggregates._sum.exposure ?? 0,
      totalDutyDeclared: txAggregates._sum.dutyDeclared ?? 0,
      totalDutyComputed: findingAggregates._sum.dutyComputed ?? 0,
      openFindingsCount,
      unmatchedTransactionsCount: unmatchedCount,
      topOffenders: {
        byBroker: top5(
          [...brokerMap.entries()].map(([name, totalExposure]) => ({
            name,
            totalExposure,
          })),
        ),
        byPort: top5(
          [...portMap.entries()].map(([name, totalExposure]) => ({
            name,
            totalExposure,
          })),
        ),
        byProduct: top5(
          [...productMap.entries()].map(([id, { name, total }]) => ({
            id,
            name,
            totalExposure: total,
          })),
        ),
      },
    };
  }
}
