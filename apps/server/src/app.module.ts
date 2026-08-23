import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { BooksModule } from './books/books.module';
import { ProgressModule } from './progress/progress.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    // 从 .env 读配置并注入到 process.env
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BooksModule,
    ProgressModule,
    UsersModule,
  ],
})
export class AppModule {}
