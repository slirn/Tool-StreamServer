// 把项目 skills/ 下的团队 skill 同步安装到全局目录（~/.claude/skills 与 ~/.agents/skills）。
// 用法：node scripts/sync-skills.mjs [--check]  （--check 只校验是否一致，不写入）
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const projectSkillsDir = path.resolve(import.meta.dirname, '../skills');
const targets = [
  path.join(homedir(), '.claude', 'skills'),
  path.join(homedir(), '.agents', 'skills'),
];
const checkOnly = process.argv.includes('--check');

const skills = existsSync(projectSkillsDir)
  ? readdirSync(projectSkillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

if (skills.length === 0) {
  console.error(`未找到任何 skill：${projectSkillsDir} 下没有子目录`);
  process.exit(1);
}

let mismatch = 0;
for (const name of skills) {
  const src = path.join(projectSkillsDir, name);
  if (!existsSync(path.join(src, 'SKILL.md'))) {
    console.error(`跳过 ${name}：缺少 SKILL.md（不是合法 skill 目录）`);
    process.exitCode = 1;
    continue;
  }
  for (const targetRoot of targets) {
    const dest = path.join(targetRoot, name);
    const same = existsSync(dest) && existsSync(path.join(dest, 'SKILL.md')) &&
      readFileSync(path.join(dest, 'SKILL.md'), 'utf8') === readFileSync(path.join(src, 'SKILL.md'), 'utf8');
    if (same) {
      console.log(`  已一致  ${name} -> ${dest}`);
    } else if (checkOnly) {
      console.log(`  不一致  ${name} -> ${dest}（需运行 npm run skills:sync）`);
      mismatch++;
    } else {
      mkdirSync(targetRoot, { recursive: true });
      rmSync(dest, { recursive: true, force: true });
      cpSync(src, dest, { recursive: true });
      console.log(`  已安装  ${name} -> ${dest}`);
    }
  }
}

if (checkOnly && mismatch > 0) process.exitCode = 1;
console.log(checkOnly ? (mismatch === 0 ? '校验通过：全局与源码一致' : `校验失败：${mismatch} 处不一致`) : '同步完成');
