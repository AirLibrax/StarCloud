import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateProgressDto {
  @IsInt()
  bookId!: number;

  @Min(0)
  @IsInt()
  currentPage!: number;

  @Min(1)
  @IsInt()
  totalPages!: number;

  @IsOptional()
  @IsString()
  @MaxLength(4096)
  position?: string | null;
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  percentage?: number;
}
