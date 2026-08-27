/**
 * 架构守护测试（ARCHITECTURE §4 依赖方向的强制执行）：
 * - core 不得 import ingress / egress / api / auth 的实现（auth 为独立策略模块，core 亦不得依赖）
 * - ingress 与 egress 互不引用
 * - core 不得使用第三方包（只允许 node: 前缀与本地相对导入）
 * 违规即测试失败——Review 清单里的"依赖方向"项由此自动化。
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(import.meta.dirname, '../');

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      out.push(...listTsFiles(p));
    } else if (entry.name.endsWith('.ts')) {
      out.push(p);
    }
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const specs: string[] = [];
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  for (const m of text.matchAll(/import\s+['"]([^'"]+)['"]/g)) specs.push(m[1]!);
  // 动态 import('x') 与 require('x')：堵住绕过面
  for (const m of text.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  for (const m of text.matchAll(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]!);
  return specs;
}

const rel = (f: string) => path.relative(SRC, f).replaceAll('\\', '/');

describe('架构守护：依赖方向（ARCHITECTURE §4）', () => {
  const files = listTsFiles(SRC);

  it('文件清单非空（扫描本身有效）', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('core 不得 import ingress / egress / api / auth / 第三方包', () => {
    const banned = /^(?:\.\.\/)*(?:ingress|egress|api|auth)\//;
    const violations: string[] = [];
    for (const f of files.filter((f) => rel(f).startsWith('core/'))) {
      for (const spec of importsOf(f)) {
        const isRelative = spec.startsWith('.');
        const normalized = spec.replace(/^(\.\.\/)+/, '');
        if (isRelative && banned.test(normalized)) {
          violations.push(`${rel(f)} -> ${spec}`);
        } else if (!isRelative && !spec.startsWith('node:')) {
          violations.push(`${rel(f)} -> ${spec}（core 禁用第三方包）`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('ingress 与 egress 互不引用', () => {
    const violations: string[] = [];
    for (const f of files.filter((f) => /^(ingress|egress)\//.test(rel(f)))) {
      const self = rel(f).split('/')[0]!;
      const other = self === 'ingress' ? 'egress' : 'ingress';
      for (const spec of importsOf(f)) {
        const normalized = spec.replace(/^(\.\.\/)+/, '');
        if (normalized.startsWith(`${other}/`)) violations.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('上层模块只能向下依赖 core/lib（auth 仅 ingress 可用）', () => {
    // 上一条已覆盖 core 出边；这里断言上层只能向下依赖 core/lib
    const allowed = new Set(['core', 'lib', 'auth']); // auth 仅 ingress 可用
    const violations: string[] = [];
    for (const f of files.filter((f) => /^(ingress|egress|api)\//.test(rel(f)))) {
      const top = rel(f).split('/')[0]!;
      for (const spec of importsOf(f)) {
        if (!spec.startsWith('.')) continue;
        // 归一化：剥离 ../ 前缀与 ./ 前缀，便于按首段判别目标模块
        const normalized = spec.replace(/^(\.\.\/)+/, '').replace(/^\.\//, '');
        const target = normalized.split('/')[0]!;
        // 同目录引用（./xxx.js）或目标落在本模块内部：合法
        if (target === top || !normalized.includes('/')) continue;
        if (top === 'ingress' ? !allowed.has(target) : target !== 'core' && target !== 'lib') {
          violations.push(`${rel(f)} -> ${spec}`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });

  it('第三方包白名单：node-media-server 仅允许出现在 ingress/nms-server.ts', () => {
    const violations: string[] = [];
    for (const f of files) {
      for (const spec of importsOf(f)) {
        if (spec.startsWith('.') || spec.startsWith('node:')) continue;
        if (spec === 'node-media-server' && rel(f) === 'ingress/nms-server.ts') continue;
        violations.push(`${rel(f)} -> ${spec}`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
