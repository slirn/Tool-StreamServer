// 把项目 skills/ 下的团队 skill 同步安装到全局目录（~/.claude/skills 与 ~/.agents/skills）。
// 用法：
//   node scripts/sync-skills.mjs          同步安装到全局目录
//   node scripts/sync-skills.mjs --check  校验全局副本与源码是否一致（本地自查用）
//   node scripts/sync-skills.mjs --ci     仅校验 skill 结构合法性（CI 用，不依赖全局目录）
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const projectSkillsDir = path.resolve(import.meta.dirname, '../skills');
const targets = [
  path.join(homedir(), '.claude', 'skills'),
  path.join(homedir(), '.agents', 'skills'),
];
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const ciMode = args.includes('--ci');

const skills = existsSync(projectSkillsDir)
  ? readdirSync(projectSkillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
  : [];

if (skills.length === 0) {
  console.error(`未找到任何 skill：${projectSkillsDir} 下没有子目录`);
  process.exit(1);
}

// 结构校验：SKILL.md 存在、front-matter 含 name/version/description、name 与目录名一致
function validate(name) {
  const file = path.join(projectSkillsDir, name, 'SKILL.md');
  if (!existsSync(file)) return '缺少 SKILL.md';
  const text = readFileSync(file, 'utf8');
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return '缺少 YAML front-matter';
  const fm = m[1];
  const nameMatch = fm.match(/^name:\s*(\S+)/m);
  if (!nameMatch) return 'front-matter 缺少 name';
  if (nameMatch[1] !== name) return `front-matter name "${nameMatch[1]}" 与目录名 "${name}" 不一致`;
  if (!/^version:\s*\S+/m.test(fm)) return 'front-matter 缺少 version';
  if (!/^description:\s*\S+/m.test(fm)) return 'front-matter 缺少 description';
  return null;
}

let failures = 0;
for (const name of skills) {
  const problem = validate(name);
  if (problem) {
    console.error(`  非法    ${name}：${problem}`);
    failures++;
    process.exitCode = 1;
    continue;
  }
  console.log(`  合法    ${name}`);
}

if (ciMode) {
  console.log(failures === 0 ? 'CI 校验通过：所有 skill 结构合法' : `CI 校验失败：${failures} 个 skill 非法`);
} else {
  let mismatch = 0;
  for (const name of skills) {
    const src = path.join(projectSkillsDir, name);
    for (const targetRoot of targets) {
      const dest = path.join(targetRoot, name);
      const same =
        existsSync(path.join(dest, 'SKILL.md')) &&
        readFileSync(path.join(dest, 'SKILL.md'), 'utf8') ===
          readFileSync(path.join(src, 'SKILL.md'), 'utf8');
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
  console.log(
    checkOnly
      ? mismatch === 0
        ? '校验通过：全局与源码一致'
        : `校验失败：${mismatch} 处不一致`
      : '同步完成',
  );
}
