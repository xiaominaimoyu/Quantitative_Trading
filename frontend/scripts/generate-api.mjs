import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const backendRoot = resolve(frontendRoot, '..', 'backend')
const openapiPath = resolve(frontendRoot, 'openapi.json')
const generatedPath = resolve(frontendRoot, 'src', 'api', 'generated', 'schema.ts')
const checkOnly = process.argv.includes('--check')

function findPython() {
  const candidates = [
    process.env.PYTHON,
    resolve(backendRoot, '.venv', 'Scripts', 'python.exe'),
    resolve(backendRoot, '.venv', 'bin', 'python'),
    'python3',
    'python',
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (candidate.includes('/') || candidate.includes('\\')) {
      if (!existsSync(candidate)) continue
    }
    const probe = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
    })
    if (probe.status === 0) return candidate
  }
  throw new Error('Python not found; set PYTHON or create backend/.venv')
}

function exportOpenApi() {
  const python = findPython()
  const source = [
    'import json',
    'from quant_trading.app import create_app',
    'print(json.dumps(create_app().openapi(), ensure_ascii=False, indent=2, sort_keys=True))',
  ].join('; ')
  const result = spawnSync(python, ['-B', '-c', source], {
    cwd: backendRoot,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PYTHONDONTWRITEBYTECODE: '1',
      PYTHONPATH: resolve(backendRoot, 'src'),
      QUANT_ENV: 'test',
      QUANT_DATABASE_URL: 'sqlite+pysqlite:///:memory:',
    },
  })
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || 'OpenAPI export failed')
  }
  return JSON.parse(result.stdout)
}

function identifier(value) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) ? value : JSON.stringify(value)
}

function referenceName(reference) {
  return reference.split('/').at(-1).replace(/[^A-Za-z0-9_$]/g, '_')
}

function literal(value) {
  return value === undefined ? 'unknown' : JSON.stringify(value)
}

function schemaType(schema, depth = 0) {
  if (!schema || typeof schema !== 'object') return 'unknown'
  if (schema.$ref) return referenceName(schema.$ref)
  if ('const' in schema) return literal(schema.const)
  if (Array.isArray(schema.enum)) return schema.enum.map(literal).join(' | ') || 'never'
  if (Array.isArray(schema.anyOf)) {
    return schema.anyOf.map((item) => schemaType(item, depth)).join(' | ')
  }
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((item) => schemaType(item, depth)).join(' | ')
  }
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.map((item) => schemaType(item, depth)).join(' & ')
  }

  const types = Array.isArray(schema.type) ? schema.type : [schema.type]
  if (types.length > 1) {
    return types.map((type) => schemaType({ ...schema, type }, depth)).join(' | ')
  }

  switch (schema.type) {
    case 'null':
      return 'null'
    case 'boolean':
      return 'boolean'
    case 'integer':
    case 'number':
      return 'number'
    case 'string':
      return 'string'
    case 'array':
      return `Array<${schemaType(schema.items, depth)}>`
    case 'object':
    case undefined: {
      const properties = schema.properties ?? {}
      const required = new Set(schema.required ?? [])
      const entries = Object.entries(properties)
      if (entries.length === 0) {
        if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
          return `Record<string, ${schemaType(schema.additionalProperties, depth)}>`
        }
        return schema.additionalProperties === false ? 'Record<string, never>' : 'Record<string, unknown>'
      }
      const indent = '  '.repeat(depth + 1)
      const closing = '  '.repeat(depth)
      const fields = entries.map(([name, value]) => {
        const optional = required.has(name) ? '' : '?'
        return `${indent}${identifier(name)}${optional}: ${schemaType(value, depth + 1)}`
      })
      return `{\n${fields.join('\n')}\n${closing}}`
    }
    default:
      return 'unknown'
  }
}

function generateTypes(openapi) {
  const schemas = openapi.components?.schemas ?? {}
  const declarations = Object.entries(schemas)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, schema]) => `export type ${referenceName(name)} = ${schemaType(schema)}\n`)

  const methods = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head'])
  const operations = Object.entries(openapi.paths ?? {})
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, item]) =>
      Object.entries(item)
        .filter(([method]) => methods.has(method))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([method, operation]) => ({
          method: method.toUpperCase(),
          path,
          operationId: operation.operationId ?? null,
        })),
    )

  return [
    '/* This file is generated by scripts/generate-api.mjs. Do not edit manually. */',
    '',
    ...declarations,
    `export const API_OPERATIONS = ${JSON.stringify(operations, null, 2)} as const`,
    '',
    'export type ApiOperation = (typeof API_OPERATIONS)[number]',
    '',
  ].join('\n')
}

function verify(path, expected) {
  const actual = existsSync(path) ? readFileSync(path, 'utf8') : null
  if (actual === expected) return true
  console.error(`Generated file is stale: ${path}`)
  return false
}

const openapi = exportOpenApi()
const openapiText = `${JSON.stringify(openapi, null, 2)}\n`
const generatedText = generateTypes(openapi)

if (checkOnly) {
  if (!verify(openapiPath, openapiText) || !verify(generatedPath, generatedText)) {
    process.exitCode = 1
  } else {
    console.log('OpenAPI and generated TypeScript are up to date')
  }
} else {
  mkdirSync(dirname(generatedPath), { recursive: true })
  writeFileSync(openapiPath, openapiText, 'utf8')
  writeFileSync(generatedPath, generatedText, 'utf8')
  console.log(`Generated ${openapiPath}`)
  console.log(`Generated ${generatedPath}`)
}
