import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBookDto {
  @IsString()
  @MaxLength(200, { message: '书名最长 200 字符' })
  title!: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
