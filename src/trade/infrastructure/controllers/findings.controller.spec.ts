import { FindingsController } from './findings.controller';
import type { IDatabasePort, PaginatedResult, FindingRecord } from '../../ports/database-port.interface';

describe('FindingsController', () => {
  const page: PaginatedResult<FindingRecord> = {
    data: [
      {
        id: 'F-1',
        dutyComputed: 100,
        exposure: 50,
        ruleId: 'R1',
        ruleName: 'Asian flat tariff',
        transactionId: 'TX-1',
        productId: 'P-1',
      },
    ],
    meta: { total: 1, page: 1, per_page: 50, total_pages: 1 },
  };

  const db = {
    getFindings: jest.fn().mockResolvedValue(page),
  } as unknown as IDatabasePort;

  let controller: FindingsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new FindingsController(db);
  });

  it('lists findings with pagination query', async () => {
    await expect(
      controller.list({ page: 2, per_page: 10 }),
    ).resolves.toEqual(page);
    expect(db.getFindings).toHaveBeenCalledWith({ page: 2, per_page: 10 });
  });
});
