/**
 * 初始化种子数据：创建默认管理员。
 * 运行: npm run seed --workspace @starcloud/server
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const username = process.env.SEED_ADMIN_NAME ?? '宫时玄';
  const password = process.env.SEED_ADMIN_PASSWORD ?? '17890';

  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    console.log(`管理员 ${username} 已存在，跳过`);
    return;
  }

  await prisma.user.create({
    data: {
      username,
      passwordHash: await bcrypt.hash(password, 10),
      isAdmin: true,
    },
  });
  console.log(`已创建管理员: ${username}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
