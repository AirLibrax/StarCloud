import {
  IsOptional,
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
} from 'class-validator';

/** 自助注册：只收用户名/密码/可选邀请码，角色字段一律不接受（whitelist 会剔除） */
export class RegisterDto {
  @IsString()
  @MinLength(1, { message: '用户名不能为空' })
  @MaxLength(50)
  username!: string;

  @IsString()
  @MinLength(4, { message: '密码至少 4 位' })
  password!: string;

  @IsString()
  @IsNotEmpty({ message: '确认密码不能为空' })
  confirmPassword!: string;

  /** 注册邀请码：门禁启用时必填（开关语义见 ../invite-gate.ts），关闭时可省略 */
  @IsOptional()
  @IsString()
  inviteCode?: string;
}