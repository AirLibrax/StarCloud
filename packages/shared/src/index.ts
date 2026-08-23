/**
 * @starcloud/shared
 * 三端共用的类型定义。改字段只改这里，三端同时生效。
 */
export * from './user';
export * from './book';
export * from './progress';

/** 后端 API 的统一错误结构 */
export interface ApiError {
  statusCode: number;
  message: string;
}
