import {
  IsOptional,
  IsString,
  IsNumber,
  IsEnum,
  Min,
} from 'class-validator';

export enum ProductType {
  Electronics = 'electronics',
  Consumable = 'consumable',
  Apparel = 'apparel',
  Furniture = 'furniture',
  RawMaterial = 'raw_material',
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  importCode?: string;

  @IsOptional()
  @IsString()
  countryOfOrigin?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  value?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  weight?: number;

  @IsOptional()
  @IsString()
  unit?: string;
}
