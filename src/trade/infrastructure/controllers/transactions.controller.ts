import {
  Controller,
  Get,
  Param,
  Query,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiNotFoundResponse, ApiQuery } from '@nestjs/swagger';
import type { IDatabasePort, PaginatedResult, TransactionRecord, TransactionDetail } from '../../ports/database-port.interface';
import { DATABASE_PORT } from '../../ports/database-port.interface';
import { ListTransactionsDto } from '../dtos/list-transactions.dto';

@ApiTags('transactions')
@Controller('transactions')
export class TransactionsController {
  constructor(
    @Inject(DATABASE_PORT) private readonly db: IDatabasePort,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all transactions',
    description: 'Paginated list of import declarations. Filter by matched/unmatched status, broker, or port.',
  })
  @ApiOkResponse({ description: 'Paginated transaction list' })
  async list(
    @Query() query: ListTransactionsDto,
  ): Promise<PaginatedResult<TransactionRecord>> {
    return this.db.getAllTransactions({
      page: query.page,
      per_page: query.per_page,
      status: query.status,
      broker: query.broker,
      port_of_entry: query.port_of_entry,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get transaction detail',
    description: 'Returns the transaction with its linked product (if matched) and checker finding (if evaluated), including the duty gap.',
  })
  @ApiOkResponse({ description: 'Transaction detail with product and finding' })
  @ApiNotFoundResponse({ description: 'Transaction not found' })
  async getOne(
    @Param('id') id: string,
  ): Promise<{ data: TransactionDetail }> {
    const detail = await this.db.getTransactionById(id);
    if (!detail) {
      throw new NotFoundException(`Transaction ${id} not found`);
    }
    return { data: detail };
  }
}
