export interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    per_page: number;
    total_pages: number;
  };
}

export interface ProductFilters {
  page?: number;
  per_page?: number;
  type?: string;
  has_findings?: boolean;
}

export interface TransactionFilters {
  page?: number;
  per_page?: number;
  status?: 'matched' | 'unmatched';
  broker?: string;
  port_of_entry?: string;
}

export interface FindingFilters {
  page?: number;
  per_page?: number;
}

export interface CheckerFindingInput {
  transactionId: string;
  productId: string | null;
  ruleId: string | null;
  ruleName: string | null;
  dutyComputed: number;
  exposure: number;
}

export interface TopOffenderItem {
  name: string;
  totalExposure: number;
}

export interface TopOffenderProduct {
  id: string;
  name: string;
  totalExposure: number;
}

export interface DashboardStats {
  totalExposure: number;
  totalDutyDeclared: number;
  totalDutyComputed: number;
  openFindingsCount: number;
  unmatchedTransactionsCount: number;
  topOffenders: {
    byBroker: TopOffenderItem[];
    byPort: TopOffenderItem[];
    byProduct: TopOffenderProduct[];
  };
}

// Minimal domain shapes used by ports (Prisma types imported in the adapter)
export interface ProductRecord {
  id: string;
  name: string;
  type: string;
  importCode: string;
  countryOfOrigin: string;
  value: number;
  weight: number;
  unit: string;
}

export interface ProductWithCount extends ProductRecord {
  openFindingsCount: number;
}

export interface TransactionRecord {
  id: string;
  date: Date;
  importer: string;
  broker: string;
  portOfEntry: string;
  importCode: string;
  countryOfOrigin: string;
  units: number;
  unitValue: number;
  totalValue: number;
  dutyDeclared: number;
  productId: string | null;
}

export interface FindingRecord {
  id: string;
  dutyComputed: number;
  exposure: number;
  ruleId: string | null;
  ruleName: string | null;
  transactionId: string;
  productId: string | null;
}

export interface TransactionDetail {
  transaction: TransactionRecord;
  product: ProductRecord | null;
  finding: FindingRecord | null;
}

export interface ProductDetail {
  product: ProductRecord;
  transactions: TransactionRecord[];
  findings: FindingRecord[];
}

export const DATABASE_PORT = Symbol('IDatabasePort');

export interface IDatabasePort {
  // Products
  getAllProducts(
    filters?: ProductFilters,
  ): Promise<PaginatedResult<ProductWithCount>>;
  getProductById(id: string): Promise<ProductDetail | null>;
  updateProduct(id: string, data: Partial<ProductRecord>): Promise<ProductRecord>;

  // Transactions
  getAllTransactions(
    filters?: TransactionFilters,
  ): Promise<PaginatedResult<TransactionRecord>>;
  getTransactionById(id: string): Promise<TransactionDetail | null>;
  getTransactionsForProduct(productId: string): Promise<TransactionRecord[]>;

  // Findings
  getFindings(
    filters?: FindingFilters,
  ): Promise<PaginatedResult<FindingRecord>>;
  upsertFinding(finding: CheckerFindingInput): Promise<void>;

  // Dashboard
  getDashboardStats(): Promise<DashboardStats>;
}
