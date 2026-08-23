import { Module } from '@nestjs/common';
import { BooksController } from './books.controller';
import { BooksService } from './books.service';
import { AuthModule } from '../auth/auth.module';

@Module({
  // JwtAuthGuard 需要 JwtService / AuthService，它们由 AuthModule 导出
  imports: [AuthModule],
  controllers: [BooksController],
  providers: [BooksService],
})
export class BooksModule {}
