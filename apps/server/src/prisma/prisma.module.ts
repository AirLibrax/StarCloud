import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global() // 全局模块：不用在每个业务模块里重复 import
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
