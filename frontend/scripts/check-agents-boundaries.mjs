#!/usr/bin/env node
/**
 * 校验 frontend 是否符合 frontend/AGENTS.md 模块边界与目录约定。
 * 在仓库根目录：pnpm check:fe:agents
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FRONTEND_ROOT = path.resolve(__dirname, '..')
const SRC_ROOT = path.join(FRONTEND_ROOT, 'src')

const errors = []

function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, name.name)
    if (name.isDirectory()) {
      if (name.name === 'node_modules' || name.name === 'dist') continue
      walkDir(full, files)
    } else if (/\.(ts|tsx)$/.test(name.name)) {
      files.push(full)
    }
  }
  return files
}

function rel(file) {
  return path.relative(FRONTEND_ROOT, file).replace(/\\/g, '/')
}

function relSrc(file) {
  return path.relative(SRC_ROOT, file).replace(/\\/g, '/')
}

function read(file) {
  return fs.readFileSync(file, 'utf8')
}

function lineCount(file) {
  return read(file).split(/\r?\n/).length
}

// —— 禁止存在的路径（目录或文件）——
const FORBIDDEN_PATHS = [
  'src/spreadsheet/engine',
  'src/helpers',
  'src/utils.ts',
  'src/components/index.ts',
]

for (const forbidden of FORBIDDEN_PATHS) {
  const full = path.join(FRONTEND_ROOT, forbidden)
  if (fs.existsSync(full)) {
    errors.push(`禁止路径存在: ${forbidden}（见 frontend/AGENTS.md §3.2）`)
  }
}

// —— src 根目录仅允许入口文件 ——
const SRC_ROOT_ALLOWED = new Set(['App.tsx', 'index.css', 'main.tsx', 'vite-env.d.ts'])
for (const name of fs.existsSync(SRC_ROOT) ? fs.readdirSync(SRC_ROOT) : []) {
  const full = path.join(SRC_ROOT, name)
  if (!fs.statSync(full).isFile()) continue
  if (!SRC_ROOT_ALLOWED.has(name) && !name.endsWith('.d.ts')) {
    errors.push(`src/ 根目录不应散落业务文件: src/${name}（应放入 components/、hooks/、spreadsheet/ 等）`)
  }
}

const sourceFiles = walkDir(SRC_ROOT)

for (const file of sourceFiles) {
  const r = relSrc(file)
  const content = read(file)

  // pages：只组装，控制体积
  if (/^pages\/.*Page\.tsx$/.test(r)) {
    const lines = lineCount(file)
    const MAX_PAGE_LINES = 100
    if (lines > MAX_PAGE_LINES) {
      errors.push(
        `${r}: ${lines} 行，超过 ${MAX_PAGE_LINES} 行。页面应只组装组件，逻辑放到 components/ 或 hooks/（AGENTS §2.9）`
      )
    }
  }

  // hooks：命名 useXxx
  if (/^hooks\//.test(r) && r !== 'hooks/index.ts') {
    const base = path.basename(file)
    if (!/^use[A-Z].*\.ts$/.test(base)) {
      errors.push(`${r}: 自定义 Hook 文件应命名为 useXxx.ts（AGENTS §2.10）`)
    }
  }

  // model/types.ts：仅基础三类型
  if (r === 'spreadsheet/model/types.ts') {
    const exports = [...content.matchAll(/^export\s+(interface|type|const|function|class)\s+(\w+)/gm)]
    const allowed = new Set(['Style', 'Cell', 'WorksheetData', 'WorkbookData'])
    for (const [, , name] of exports) {
      if (!allowed.has(name)) {
        errors.push(
          `spreadsheet/model/types.ts: 不应导出 "${name}"，请放到 model/ 下独立文件（AGENTS §2.12）`
        )
      }
    }
  }

  // render：只画，不写交互 / 不改 Store
  if (r.startsWith('spreadsheet/render/')) {
    if (/@\/spreadsheet\/interaction|spreadsheet\/interaction\//.test(content)) {
      errors.push(`${r}: render 模块不得依赖 interaction（AGENTS §2.1 R3）`)
    }
    if (/\b(useDispatch|dispatch\s*\(|createSlice|configureStore)\b/.test(content)) {
      errors.push(`${r}: render 模块不得 dispatch 或定义 Store（AGENTS §2.1 R2）`)
    }
  }

  // interaction：只改数据，不画 Canvas
  if (r.startsWith('spreadsheet/interaction/')) {
    if (/@\/spreadsheet\/render\/(gridRenderer|viewport)|spreadsheet\/render\/(gridRenderer|viewport)/.test(content)) {
      errors.push(
        `${r}: interaction 不得 import gridRenderer/viewport，仅允许 render/chrome 常量（AGENTS §2.2 I1）`
      )
    }
    if (/\b(getContext\s*\(\s*['"]2d['"]|\.fillRect\s*\(|\.fillText\s*\(|\.strokeRect\s*\()/.test(content)) {
      errors.push(`${r}: interaction 模块不得包含 Canvas 绘制代码（AGENTS §2.2 I2）`)
    }
  }

  // store：无 Canvas
  if (r.startsWith('spreadsheet/store/')) {
    if (/\b(getContext\s*\(\s*['"]2d['"]|\.fillRect\s*\()/.test(content)) {
      errors.push(`${r}: store 模块不得包含 Canvas/DOM 绘制（AGENTS §2.5 S1）`)
    }
  }
}

// —— 输出 ——
if (errors.length === 0) {
  console.log(`✓ frontend AGENTS 边界检查通过（${sourceFiles.length} 个源文件）`)
  process.exit(0)
}

console.error('✗ frontend AGENTS 边界检查未通过:\n')
for (const e of errors) {
  console.error(`  • ${e}`)
}
console.error('\n详见 frontend/AGENTS.md，修复后重试: pnpm check:fe:agents')
process.exit(1)
