import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiOkResponse, ApiNotFoundResponse, ApiBadRequestResponse } from '@nestjs/swagger';
import type { IDatabasePort, PaginatedResult, ProductWithCount, ProductRecord, ProductDetail } from '../../ports/database-port.interface';
import { DATABASE_PORT } from '../../ports/database-port.interface';
import type { ICheckerPort } from '../../ports/checker-port.interface';
import { CHECKER_PORT } from '../../ports/checker-port.interface';
import { UpdateProductDto } from '../dtos/update-product.dto';
import { ListProductsDto } from '../dtos/list-products.dto';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(
    @Inject(DATABASE_PORT) private readonly db: IDatabasePort,
    @Inject(CHECKER_PORT) private readonly checker: ICheckerPort,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List all products',
    description: 'Paginated product catalog. Each item includes openFindingsCount. Filter by type or has_findings.',
  })
  @ApiOkResponse({ description: 'Paginated product list with findings count' })
  async list(
    @Query() query: ListProductsDto,
  ): Promise<PaginatedResult<ProductWithCount>> {
    return this.db.getAllProducts({
      page: query.page,
      per_page: query.per_page,
      type: query.type,
      has_findings: query.has_findings,
    });
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get product detail',
    description: 'Returns the product with all linked transactions and active checker findings.',
  })
  @ApiOkResponse({ description: 'Product detail with transactions and findings' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  async getOne(
    @Param('id') id: string,
  ): Promise<{ data: ProductDetail }> {
    const detail = await this.db.getProductById(id);
    if (!detail) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return { data: detail };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a product',
    description:
      'Partially updates a product record. After saving, immediately re-runs the CheckerEngine for all transactions linked to this product and upserts their findings. This is the primary correction action.',
  })
  @ApiOkResponse({ description: 'Updated product record' })
  @ApiNotFoundResponse({ description: 'Product not found' })
  @ApiBadRequestResponse({ description: 'Validation error' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<{ data: ProductRecord }> {
    // Verify product exists first
    const existing = await this.db.getProductById(id);
    if (!existing) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    const updated = await this.db.updateProduct(id, {
      importCode: dto.importCode,
      countryOfOrigin: dto.countryOfOrigin,
      type: dto.type,
      value: dto.value,
      weight: dto.weight,
      unit: dto.unit,
    });

    // Re-evaluate all transactions linked to this product
    await this.checker.runForProduct(id);

    return { data: updated };
  }
}
