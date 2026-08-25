/**
 * 注册邀请码门禁（可选功能，模块化可拆卸）。
 *
 * 开关语义（唯一配置项：apps/server/.env 的 INVITE_CODE）：
 * - 非空                = 启用：注册请求必须携带匹配的邀请码，否则 403；
 * - 为空 / 变量缺失      = 关闭：注册不做任何口令校验；
 * - 彻底卸载             = 删除 .env 中的 INVITE_CODE 行即可，无需改动任何代码。
 *
 * 对外暴露的 registration 接口只返回「是否需要口令」布尔值，绝不返回口令本身。
 */
import { ForbiddenException } from '@nestjs/common';

/** 注册是否需要邀请码（前端据此自适应渲染输入框） */
export function isInviteCodeRequired(): boolean {
  return (process.env.INVITE_CODE ?? '').trim().length > 0;
}

/** 校验注册请求携带的邀请码；门禁关闭时直接放行 */
export function assertInviteCode(inviteCode: string | undefined): void {
  if (!isInviteCodeRequired()) return;
  if (inviteCode !== process.env.INVITE_CODE) {
    throw new ForbiddenException('注册口令错误');
  }
}