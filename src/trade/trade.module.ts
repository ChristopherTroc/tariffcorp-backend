import { Module } from '@nestjs/common';
import { DATABASE_PORT } from './ports/database-port.interface';
import { CHECKER_PORT } from './ports/checker-port.interface';
import { PrismaService } from './infrastructure/adapters/prisma.service';
import { PrismaTradeAdapter } from './infrastructure/adapters/prisma-trade.adapter';
import { CheckerEngine } from './domain/checker.engine';
import { DashboardController } from './infrastructure/controllers/dashboard.controller';
import { TransactionsController } from './infrastructure/controllers/transactions.controller';
import { ProductsController } from './infrastructure/controllers/products.controller';
import { FindingsController } from './infrastructure/controllers/findings.controller';

@Module({
  controllers: [
    DashboardController,
    TransactionsController,
    ProductsController,
    FindingsController,
  ],
  providers: [
    PrismaService,
    {
      provide: DATABASE_PORT,
      useClass: PrismaTradeAdapter,
    },
    {
      provide: CHECKER_PORT,
      useFactory: (db: PrismaTradeAdapter) => new CheckerEngine(db),
      inject: [DATABASE_PORT],
    },
  ],
})
export class TradeModule {}
