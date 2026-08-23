import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 全局校验管道：所有 DTO 自动做类型与规则校验，非法请求直接 400
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 剔除 DTO 里未声明的字段
      transform: true, // 按声明的类型自动转换
    }),
  );

  app.enableCors(); // 允许 admin / mobile 跨域访问

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`[starcloud-server] listening on http://localhost:${port}`);
}

bootstrap();
