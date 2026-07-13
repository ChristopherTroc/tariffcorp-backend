import { IsOptional, IsIn, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListTransactionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  per_page?: number = 10;

  @IsOptional()
  @IsIn(['matched', 'unmatched'])
  status?: 'matched' | 'unmatched';

  @IsOptional()
  @IsString()
  broker?: string;

  @IsOptional()
  @IsString()
  port_of_entry?: string;
}
