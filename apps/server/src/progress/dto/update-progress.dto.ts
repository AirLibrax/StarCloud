import { IsInt, Min } from 'class-validator';

export class UpdateProgressDto {
  @IsInt()
  bookId!: number;

  @Min(0)
  @IsInt()
  currentPage!: number;

  @Min(1)
  @IsInt()
  totalPages!: number;
}
