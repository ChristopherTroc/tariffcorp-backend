import { NotFoundException } from '@nestjs/common';
import { TransactionsController } from './transactions.controller';
import type {
  IDatabasePort,
  PaginatedResult,
  TransactionRecord,
  TransactionDetail,
} from '../../ports/database-port.interface';

describe('TransactionsController', () => {
  const listResult: PaginatedResult<TransactionRecord> = {
    data: [],
    meta: { total: 0, page: 1, per_page: 20, total_pages: 0 },
  };

  const detail: TransactionDetail = {
    transaction: {
      id: 'TX-1',
      date: new Date('2026-01-01'),
      importer: 'Acme',
      broker: 'Beacon',
      portOfEntry: 'LAX',
      importCode: '1234',
      countryOfOrigin: 'CN',
      units: 1,
      unitValue: 10,
      totalValue: 10,
      dutyDeclared: 0,
      productId: 'P-1',
    },
    product: null,
    finding: null,
  };

  const getAllTransactions = jest.fn().mockResolvedValue(listResult);
  const getTransactionById = jest.fn();
  const db = {
    getAllTransactions,
    getTransactionById,
  } as unknown as IDatabasePort;

  let controller: TransactionsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new TransactionsController(db);
  });

  it('lists transactions with filters', async () => {
    await expect(
      controller.list({
        page: 1,
        per_page: 10,
        status: 'unmatched',
        broker: 'Beacon',
        port_of_entry: 'LAX',
      }),
    ).resolves.toEqual(listResult);

    expect(getAllTransactions).toHaveBeenCalledWith({
      page: 1,
      per_page: 10,
      status: 'unmatched',
      broker: 'Beacon',
      port_of_entry: 'LAX',
    });
  });

  it('returns transaction detail when found', async () => {
    getTransactionById.mockResolvedValue(detail);
    await expect(controller.getOne('TX-1')).resolves.toEqual({ data: detail });
  });

  it('throws NotFoundException when missing', async () => {
    getTransactionById.mockResolvedValue(null);
    await expect(controller.getOne('TX-MISSING')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
