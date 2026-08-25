import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateBookDto {
  /** 可留空：EPUB 会从内嵌元数据/文件名自动识别 */
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: '书名最长 200 字符' })
  title?: string;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
