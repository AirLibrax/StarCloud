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

  /** 上传时可选指定分类（multipart 文本字段） */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  /** 上传时可选指定标签：逗号分隔字符串，如 "玄幻,连载" */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  tags?: string;
}
