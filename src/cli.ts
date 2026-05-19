import { foregroundChild } from 'foreground-child';
import { readFileSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import sade from 'sade';
import * as findUp from 'empathic/find';
import * as pkgUp from 'empathic/package';
import { outputReport } from './commands/report.js';
import { runCheckCoverage } from './commands/check-coverage.js';
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
  mergeAsync: false,
  experimentalMonocart: false,
};

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function loadPackageJsonConfig(): Partial<CliOptions> {
  const pkgPath = pkgUp.up();
  if (!pkgPath) return {};
  const pkg = readJsonFile(pkgPath);
  if (isPlainObject(pkg) && isPlainObject(pkg.c8)) {
    return pkg.c8 as Partial<CliOptions>;
  }
  return {};
}

function loadRcFile(explicitPath: string | undefined): Partial<CliOptions> {
  const path =
    explicitPath ??
    findUp.any(['.c8rc', '.c8rc.json', '.nycrc', '.nycrc.json']);
  if (!path) return {};
  const data = readJsonFile(path);
  if (!isPlainObject(data)) return {};
  return data as Partial<CliOptions>;
}

function resolveOptions(parsed: Record<string, unknown>): CliOptions {
  const pkgConfig = loadPackageJsonConfig();
  const rcConfig = loadRcFile(parsed['config'] as string | undefined);

  // Precedence (low → high): built-in defaults, package.json "c8", rc file, CLI.
  const merged: Record<string, unknown> = {
    ...defaultOptions,
    ...pkgConfig,
    ...rcConfig,
    ...parsed,
  };

  // sade emits both kebab and camel names; prefer the camel form.
  if (
    merged['reports-dir'] !== undefined &&
    merged['reportsDirectory'] === undefined
  ) {
    merged['reportsDirectory'] = merged['reports-dir'];
  }
  if (
    merged['temp-directory'] !== undefined &&
    merged['tempDirectory'] === undefined
  ) {
    merged['tempDirectory'] = merged['temp-directory'];
  }

  const opts = merged as unknown as CliOptions;

  if (!opts.tempDirectory) {
    opts.tempDirectory = resolve(opts.reportsDirectory, 'tmp');
  }

  if ((merged['100'] as boolean) === true) {
    opts.checkCoverage = true;
    opts.lines = 100;
    opts.functions = 100;
    opts.branches = 100;
    opts.statements = 100;
  }

  for (const key of ['reporter', 'include', 'exclude', 'extension'] as const) {
    const v = opts[key];
    if (typeof v === 'string') {
      (opts as unknown as Record<string, unknown>)[key] = [v];
    }
  }

  return opts;
}

function registerSharedOptions(prog: sade.Sade): sade.Sade {
  return prog
    .option('-c, --config', 'path to JSON configuration file')
    .option('-r, --reporter', 'coverage reporter(s) to use', 'text')
    .option(
      '-o, --reports-dir',
      'directory where coverage reports will be output to',
      './coverage',
    )
    .option(
      '--all',
      'consider all src files in cwd when determining coverage',
      false,
    )
    .option('--src', 'override cwd as the default --all root (repeatable)')
    .option(
      '--exclude-node-modules',
      'exclude **/node_modules/** by default',
      true,
    )
    .option('-n, --include', 'files that should be covered (glob)')
    .option('-x, --exclude', 'files/directories to exclude (glob)')
    .option('-e, --extension', 'file extensions to cover')
    .option(
      '-a, --exclude-after-remap',
      'apply exclude logic to files after source-map remap',
      false,
    )
    .option('--skip-full', 'hide files with 100% coverage', false)
    .option(
      '--check-coverage',
      'check whether coverage is within thresholds',
      false,
    )
    .option('--branches', 'minimum % of branches required', 0)
    .option('--functions', 'minimum % of functions required', 0)
    .option('--lines', 'minimum % of lines required', 90)
    .option('--statements', 'minimum % of statements required', 0)
    .option('--per-file', 'check thresholds per file', false)
    .option(
      '--100',
      'shortcut for --check-coverage with all thresholds at 100',
      false,
    )
    .option('--temp-directory', 'directory V8 coverage data is written/read')
    .option('--clean', 'delete temp files before script execution', true)
    .option('--resolve', 'resolve paths to alternate base directory', '')
    .option('--wrapper-length', 'wrapper prefix bytes on executed JavaScript')
    .option(
      '--omit-relative',
      'omit any paths that are not absolute, e.g. internal/net.js',
      true,
    )
    .option(
      '--allow-external',
      'allow files from outside the cwd in coverage',
      false,
    )
    .option(
      '--merge-async',
      'merge V8 coverage reports asynchronously and incrementally',
      false,
    )
    .option('--experimental-monocart', 'use Monocart coverage reports', false);
}

async function runInstrumenter(argv: string[]): Promise<void> {
  let parsed: Record<string, unknown> | undefined;
  const prog = registerSharedOptions(
    sade('c8 [opts] -- <script> [script-args]', true)
      .describe('Output coverage reports using Node.js built-in V8 coverage')
      .example('-- node foo.js')
      .example('--reporter lcov -- node foo.js')
      .example('report')
      .example('check-coverage --lines 95'),
  );

  prog.action((opts) => {
    parsed = opts as Record<string, unknown>;
  });

  // sade's TS for parse options doesn't expose mri's `--`, but it forwards it.
  prog.parse(['node', 'c8', ...argv], { '--': true } as Parameters<
    sade.Sade['parse']
  >[1]);

  if (!parsed) return; // sade printed help and exited

  const childArgs = (parsed['--'] as string[] | undefined) ?? [];
  const [program, ...programArgs] = childArgs;
  if (program === undefined) {
    console.error(
      'c8: must provide a script after `--`, or a subcommand (report, check-coverage)',
    );
    process.exit(1);
  }

  const opts = resolveOptions(parsed);

  if (opts.clean) {
    await rm(opts.tempDirectory, { recursive: true, force: true });
  }
  await mkdir(opts.tempDirectory, { recursive: true });
  process.env.NODE_V8_COVERAGE = opts.tempDirectory;

  foregroundChild(program, programArgs, async () => {
    try {
      await outputReport(opts);
      return Number(process.exitCode || 0);
    } catch (err) {
      console.error((err as Error).stack);
      return 1;
    }
  });
}

async function runSubcommand(argv: string[]): Promise<void> {
  let action: 'report' | 'check-coverage' | undefined;
  let parsed: Record<string, unknown> | undefined;

  const prog = sade('c8').describe(
    'Output coverage reports using Node.js built-in V8 coverage',
  );

  registerSharedOptions(
    prog
      .command('report')
      .describe('read V8 coverage data from temp and output report')
      .action((opts) => {
        action = 'report';
        parsed = opts as Record<string, unknown>;
      }),
  );

  registerSharedOptions(
    prog
      .command('check-coverage')
      .describe('check whether coverage is within thresholds provided')
      .example('check-coverage --lines 95')
      .action((opts) => {
        action = 'check-coverage';
        parsed = opts as Record<string, unknown>;
      }),
  );

  prog.parse(['node', 'c8', ...argv]);

  if (!parsed || !action) return;

  const opts = resolveOptions(parsed);

  if (action === 'report') {
    await outputReport(opts);
  } else {
    await runCheckCoverage(opts);
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv[0] === 'report' || argv[0] === 'check-coverage') {
    await runSubcommand(argv);
  } else {
    await runInstrumenter(argv);
  }
}

main().catch((err) => {
  console.error((err as Error).stack);
  process.exitCode = 1;
});
