import { ArrayNotEmpty, IsArray, IsInt } from 'class-validator';

export class BatchDeleteDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请选择要删除的书籍' })
  @IsInt({ each: true })
  ids!: number[];
}