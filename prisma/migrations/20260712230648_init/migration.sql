-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "import_code" TEXT NOT NULL,
    "country_of_origin" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "importer" TEXT NOT NULL,
    "broker" TEXT NOT NULL,
    "port_of_entry" TEXT NOT NULL,
    "import_code" TEXT NOT NULL,
    "country_of_origin" TEXT NOT NULL,
    "units" INTEGER NOT NULL,
    "unit_value" DOUBLE PRECISION NOT NULL,
    "total_value" DOUBLE PRECISION NOT NULL,
    "duty_declared" DOUBLE PRECISION NOT NULL,
    "product_id" TEXT,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checker_findings" (
    "id" TEXT NOT NULL,
    "duty_computed" DOUBLE PRECISION NOT NULL,
    "exposure" DOUBLE PRECISION NOT NULL,
    "rule_id" TEXT,
    "rule_name" TEXT,
    "transaction_id" TEXT NOT NULL,
    "product_id" TEXT,

    CONSTRAINT "checker_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "checker_findings_transaction_id_key" ON "checker_findings"("transaction_id");

-- CreateIndex
CREATE INDEX "checker_findings_exposure_idx" ON "checker_findings"("exposure" DESC);

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checker_findings" ADD CONSTRAINT "checker_findings_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checker_findings" ADD CONSTRAINT "checker_findings_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
