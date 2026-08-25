/** 用户公开信息（不含密码等敏感字段） */
export interface UserPublic {
  id: number;
  username: string;
  isAdmin: boolean;
  isActive: boolean;
  createdAt: string;
}

/** 登录响应 */
export interface LoginResponse {
  accessToken: string;
  user: UserPublic;
}
