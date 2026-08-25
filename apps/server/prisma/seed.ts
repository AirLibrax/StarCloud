/**
 * 初始化种子数据：从同目录 admins.json 读取管理员账号并逐个创建。
 * 模板见 admins.example.json —— 复制为 admins.json 后按需修改即可。
 * 运行: npm run seed --workspace @starcloud/server
 *
 * 安全约定：凭据只从 admins.json 读取，代码内不含任何默认账号；
 * 文件缺失、JSON 损坏或条目缺字段时一律拒绝运行（exitCode=1）。
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const prisma = new PrismaClient();

interface AdminEntry {
  username: string;
  password: string;
}

/** 读取并校验 admins.json；任何异常都会置 process.exitCode = 1 */
function loadAdmins(): AdminEntry[] {
  // 兼容两处位置：源码运行（prisma/ 下）与编译后运行（Docker 生产，dist/ 下）
  const candidates = [
    resolve(__dirname, '../prisma/admins.json'),
    resolve(__dirname, 'admins.json'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) {
    console.error(
      '[seed] 未找到 admins.json：请先将 admins.example.json 复制为 admins.json 并修改其中的账号密码',
    );
    process.exitCode = 1;
    return [];
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    console.error('[seed] admins.json 解析失败，拒绝运行:', (e as Error).message);
    process.exitCode = 1;
    return [];
  }

  if (!Array.isArray(raw)) {
    console.error(
      '[seed] admins.json 格式错误：必须是数组，例如 [{ "username": "管理员名", "password": "密码" }]',
    );
    process.exitCode = 1;
    return [];
  }

  const admins: AdminEntry[] = [];
  for (const item of raw) {
    const entry = item as { username?: unknown; password?: unknown } | null;
    if (
      !entry ||
      typeof entry.username !== 'string' ||
      typeof entry.password !== 'string' ||
      !entry.username.trim() ||
      !entry.password
    ) {
      console.error(
        '[seed] admins.json 中存在缺少 username/password 的条目，拒绝运行',
      );
      process.exitCode = 1;
      return [];
    }
    admins.push({ username: entry.username.trim(), password: entry.password });
  }
  return admins;
}

async function main() {
  const admins = loadAdmins();
  if (process.exitCode) return;

  for (const { username, password } of admins) {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.log(`管理员 ${username} 已存在，跳过`);
      continue;
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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());