import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ServeStaticModule } from '@nestjs/serve-static';
import { resolve } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BooksModule } from './books/books.module';
import { ProgressModule } from './progress/progress.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // 从 .env 读配置并注入到 process.env
    ConfigModule.forRoot({ isGlobal: true }),
    // 上传的书籍文件与封面图（dist -> server -> apps）
    ServeStaticModule.forRoot({
      rootPath: resolve(__dirname, '..', '..', 'server', 'uploads'),
      serveRoot: '/uploads',
    }),
    // 生产部署：托管管理后台构建产物，全站一个进程
    // （admin/dist 不存在时此模块静默跳过，不影响开发）
    // exclude 使用 path-to-regexp v8 通配语法（NestJS 11 / Express 5 下的
    // @nestjs/serve-static 5.x）；v4 的 /api/(.*) 写法会抛 PathError。
    ServeStaticModule.forRoot({
      rootPath: resolve(__dirname, '..', '..', '..', 'apps', 'admin', 'dist'),
      exclude: ['/api/{*splat}'],
    }),
    PrismaModule,
    AuthModule,
    BooksModule,
    ProgressModule,
    UsersModule,
  ],
})
export class AppModule {}
