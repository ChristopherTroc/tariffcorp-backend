import { NotFoundException } from '@nestjs/common';
import { ProductsController } from './products.controller';
import type {
  IDatabasePort,
  PaginatedResult,
  ProductWithCount,
  ProductDetail,
  ProductRecord,
} from '../../ports/database-port.interface';
import type { ICheckerPort } from '../../ports/checker-port.interface';

describe('ProductsController', () => {
  const listResult: PaginatedResult<ProductWithCount> = {
    data: [],
    meta: { total: 0, page: 1, per_page: 10, total_pages: 0 },
  };

  const product: ProductRecord = {
    id: 'P-1',
    name: 'Widget',
    type: 'electronics',
    importCode: '1234',
    countryOfOrigin: 'CN',
    value: 100,
    weight: 1,
    unit: 'kg',
  };

  const detail: ProductDetail = {
    product,
    transactions: [],
    findings: [],
  };

  const getAllProducts = jest.fn().mockResolvedValue(listResult);
  const getProductById = jest.fn();
  const updateProduct = jest.fn().mockResolvedValue(product);
  const runForProduct = jest.fn().mockResolvedValue(undefined);

  const db = {
    getAllProducts,
    getProductById,
    updateProduct,
  } as unknown as IDatabasePort;

  const checker = { runForProduct } as unknown as ICheckerPort;

  let controller: ProductsController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ProductsController(db, checker);
  });

  it('lists products with filters', async () => {
    await expect(
      controller.list({
        page: 1,
        per_page: 10,
        type: 'electronics',
        has_findings: true,
      }),
    ).resolves.toEqual(listResult);

    expect(getAllProducts).toHaveBeenCalledWith({
      page: 1,
      per_page: 10,
      type: 'electronics',
      has_findings: true,
    });
  });

  it('returns product detail when found', async () => {
    getProductById.mockResolvedValue(detail);
    await expect(controller.getOne('P-1')).resolves.toEqual({ data: detail });
  });

  it('throws NotFoundException for missing product', async () => {
    getProductById.mockResolvedValue(null);
    await expect(controller.getOne('P-X')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('updates product and re-runs checker', async () => {
    getProductById.mockResolvedValue(detail);
    await expect(
      controller.update('P-1', {
        countryOfOrigin: 'TW',
        value: 200,
      }),
    ).resolves.toEqual({ data: product });

    expect(updateProduct).toHaveBeenCalledWith('P-1', {
      importCode: undefined,
      countryOfOrigin: 'TW',
      type: undefined,
      value: 200,
      weight: undefined,
      unit: undefined,
    });
    expect(runForProduct).toHaveBeenCalledWith('P-1');
  });

  it('throws NotFoundException on update when product missing', async () => {
    getProductById.mockResolvedValue(null);
    await expect(controller.update('P-X', {})).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(updateProduct).not.toHaveBeenCalled();
    expect(runForProduct).not.toHaveBeenCalled();
  });
});
