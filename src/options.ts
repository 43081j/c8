import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as findUp from 'empathic/find';
import * as pkgUp from 'empathic/package';
import { DEFAULT_EXCLUDE, DEFAULT_EXTENSION } from './constants.js';
import type { ReportOptions } from './report.js';

export interface CliOptions extends ReportOptions {
  clean: boolean;
  checkCoverage: boolean;
  lines: number;
  functions: number;
  branches: number;
  statements: number;
  perFile: boolean;
  experimentalMonocart: boolean;
}

const defaultOptions: CliOptions = {
  reporter: ['text'],
  reportsDirectory: './coverage',
  reporterOptions: {},
  watermarks: {},
  all: false,
  excludeNodeModules: true,
  include: [],
  exclude: DEFAULT_EXCLUDE,
  extension: DEFAULT_EXTENSION,
  excludeAfterRemap: false,
  skipFull: false,
  checkCoverage: false,
  branches: 0,
  functions: 0,
  lines: 90,
  statements: 0,
  perFile: false,
  tempDirectory: process.env.NODE_V8_COVERAGE ?? '',
  clean: true,
  resolve: '',
  wrapperLength: 0,
  omitRelative: true,
  allowExternal: false,
  experimentalMonocart: false,
};

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadPackageJsonConfig(): Record<string, unknown> {
  const pkgPath = pkgUp.up();
  if (!pkgPath) return {};
  const pkg = readJsonFile(pkgPath);
  if (isPlainObject(pkg) && isPlainObject(pkg.c8)) {
    return pkg.c8;
  }
  return {};
}

function loadRcFile(explicitPath: string | undefined): Record<string, unknown> {
  const path =
    explicitPath ??
    findUp.any(['.c8rc', '.c8rc.json', '.nycrc', '.nycrc.json']);
  if (!path) return {};
  const data = readJsonFile(path);
  return isPlainObject(data) ? data : {};
}

// Canonical CliOptions keys that any input source may provide.
const CLI_FIELDS = [
  'reporter',
  'reportsDirectory',
  'all',
  'src',
  'excludeNodeModules',
  'include',
  'exclude',
  'extension',
  'excludeAfterRemap',
  'skipFull',
  'checkCoverage',
  'branches',
  'functions',
  'lines',
  'statements',
  'perFile',
  'tempDirectory',
  'clean',
  'resolve',
  'wrapperLength',
  'omitRelative',
  'allowExternal',
  'experimentalMonocart',
] as const satisfies readonly (keyof CliOptions)[];

// Config-only fields (not exposed as CLI flags, but valid in rc/package.json).
const CONFIG_ONLY_FIELDS = [
  'reporterOptions',
  'watermarks',
  'monocartArgv',
] as const satisfies readonly (keyof CliOptions)[];

// Kebab aliases sade emits (and that older rc files may use)
const KEBAB_ALIASES: Record<string, keyof CliOptions> = {
  'reports-dir': 'reportsDirectory',
  'exclude-node-modules': 'excludeNodeModules',
  'exclude-after-remap': 'excludeAfterRemap',
  'skip-full': 'skipFull',
  'check-coverage': 'checkCoverage',
  'per-file': 'perFile',
  'temp-directory': 'tempDirectory',
  'wrapper-length': 'wrapperLength',
  'omit-relative': 'omitRelative',
  'allow-external': 'allowExternal',
  'experimental-monocart': 'experimentalMonocart',
};

function pickCliFields(source: Record<string, unknown>): Partial<CliOptions> {
  const out: Partial<CliOptions> = {};
  // Kebab first; canonical camel form takes precedence when both are present.
  for (const [alias, canonical] of Object.entries(KEBAB_ALIASES)) {
    if (source[alias] !== undefined) {
      (out as Record<string, unknown>)[canonical] = source[alias];
    }
  }
  for (const key of CLI_FIELDS) {
    if (source[key] !== undefined) {
      (out as Record<string, unknown>)[key] = source[key];
    }
  }
  for (const key of CONFIG_ONLY_FIELDS) {
    if (source[key] !== undefined) {
      (out as Record<string, unknown>)[key] = source[key];
    }
  }
  return out;
}

export function resolveOptions(parsed: Record<string, unknown>): CliOptions {
  const pkgConfig = pickCliFields(loadPackageJsonConfig());
  const rcConfig = pickCliFields(
    loadRcFile(parsed['config'] as string | undefined),
  );
  const cliConfig = pickCliFields(parsed);

  // Precedence (low to high): built-in defaults, package.json "c8", rc file, CLI.
  const opts: CliOptions = {
    ...defaultOptions,
    ...pkgConfig,
    ...rcConfig,
    ...cliConfig,
  };

  if (parsed['100'] === true) {
    opts.checkCoverage = true;
    opts.lines = 100;
    opts.functions = 100;
    opts.branches = 100;
    opts.statements = 100;
  }

  if (!opts.tempDirectory) {
    opts.tempDirectory = resolve(opts.reportsDirectory, 'tmp');
  }

  for (const key of ['reporter', 'include', 'exclude', 'extension'] as const) {
    const v: unknown = opts[key];
    if (typeof v === 'string') {
      (opts as unknown as Record<string, unknown>)[key] = [v];
    }
  }

  return opts;
}
