import { Controller, Get, Query, Inject } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import type { IDatabasePort, PaginatedResult, FindingRecord } from '../../ports/database-port.interface';
import { DATABASE_PORT } from '../../ports/database-port.interface';
import { ListFindingsDto } from '../dtos/list-findings.dto';

@ApiTags('findings')
@Controller('findings')
export class FindingsController {
  constructor(
    @Inject(DATABASE_PORT) private readonly db: IDatabasePort,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all checker findings',
    description:
      'Returns all findings ordered by exposure DESC (highest dollar gap first). Each finding includes ruleId, ruleName, dutyDeclared, dutyComputed, and exposure.',
  })
  @ApiOkResponse({ description: 'Paginated findings ordered by exposure descending' })
  async list(
    @Query() query: ListFindingsDto,
  ): Promise<PaginatedResult<FindingRecord>> {
    return this.db.getFindings({
      page: query.page,
      per_page: query.per_page,
    });
  }
}
