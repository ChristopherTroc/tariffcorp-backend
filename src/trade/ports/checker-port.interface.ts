export const CHECKER_PORT = Symbol('ICheckerPort');

export interface ICheckerPort {
  /** Fetch transaction by ID, evaluate rules, persist finding. */
  runForTransactionId(transactionId: string): Promise<void>;
  /** Re-run checker for every transaction linked to this product. */
  runForProduct(productId: string): Promise<void>;
}
