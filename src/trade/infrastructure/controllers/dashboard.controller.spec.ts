import { DashboardController } from './dashboard.controller';
import type {
  IDatabasePort,
  DashboardStats,
} from '../../ports/database-port.interface';

describe('DashboardController', () => {
  const stats: DashboardStats = {
    totalExposure: 100,
    totalDutyDeclared: 50,
    totalDutyComputed: 150,
    openFindingsCount: 3,
    unmatchedTransactionsCount: 1,
    topOffenders: { byBroker: [], byPort: [], byProduct: [] },
  };

  const getDashboardStats = jest.fn().mockResolvedValue(stats);
  const db = { getDashboardStats } as unknown as IDatabasePort;

  let controller: DashboardController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new DashboardController(db);
  });

  it('returns dashboard stats wrapped in data', async () => {
    await expect(controller.getStats()).resolves.toEqual({ data: stats });
    expect(getDashboardStats).toHaveBeenCalledTimes(1);
  });
});
