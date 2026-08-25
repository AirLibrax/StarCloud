import {
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1, { message: '用户名不能为空' })
  @MaxLength(50)
  username!: string;

  @IsString()
  @MinLength(4, { message: '密码至少 4 位' })
  password!: string;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  username?: string;

  @IsOptional()
  @IsBoolean()
  isAdmin?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ChangePasswordDto {
  @IsString()
  oldPassword!: string;

  @IsString()
  @MinLength(4, { message: '新密码至少 4 位' })
  newPassword!: string;

  @IsString()
  @IsNotEmpty({ message: '确认新密码不能为空' })
  confirmPassword!: string;
}

/** 管理员重置用户密码：只收新密码，不校验旧密码 */
export class ResetPasswordDto {
  @IsString()
  @MinLength(4, { message: '新密码至少 4 位' })
  newPassword!: string;
}
