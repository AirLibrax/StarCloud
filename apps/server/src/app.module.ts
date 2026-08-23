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
    ServeStaticModule.forRoot({
      rootPath: resolve(__dirname, '..', '..', '..', 'apps', 'admin', 'dist'),
      exclude: ['/api/(.*)'],
    }),
    PrismaModule,
    AuthModule,
    BooksModule,
    ProgressModule,
    UsersModule,
  ],
})
export class AppModule {}
