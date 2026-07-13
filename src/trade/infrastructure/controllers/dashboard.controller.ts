import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import type { IDatabasePort, DashboardStats } from '../../ports/database-port.interface';
import { DATABASE_PORT } from '../../ports/database-port.interface';

@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(
    @Inject(DATABASE_PORT) private readonly db: IDatabasePort,
  ) {}

  @Get('stats')
  @ApiOperation({
    summary: 'C-level financial rollups',
    description:
      'Returns total exposure, duty declared vs computed, open findings count, unmatched transaction count, and top-5 offenders by broker, port, and product.',
  })
  @ApiOkResponse({ description: 'Dashboard statistics' })
  async getStats(): Promise<{ data: DashboardStats }> {
    const stats = await this.db.getDashboardStats();
    return { data: stats };
  }
}
