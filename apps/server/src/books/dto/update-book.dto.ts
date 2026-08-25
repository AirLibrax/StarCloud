import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateBookDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty({ message: '书名不能为空' })
  @MaxLength(200, { message: '书名最长 200 字符' })
  title?: string;

  /** 卷数；传 null 表示清除卷号 */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  volume?: number | null;

  @IsOptional()
  @IsString()
  author?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** 分类；传 null 或空串表示清除 */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string | null;

  /** 标签，逗号分隔；整体替换语义 */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;
}