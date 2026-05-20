import sade from 'sade';
import { reportAction } from './commands/report.js';
import { checkCoverageAction } from './commands/check-coverage.js';
import { instrumentAction } from './commands/instrument.js';

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

async function main(): Promise<void> {
  const prog = sade('c8').describe(
    'Output coverage reports using Node.js built-in V8 coverage',
  );

  registerSharedOptions(
    prog
      .command('instrument', 'instrument and run a script', { default: true })
      .example('-- node foo.js')
      .example('--reporter lcov -- node foo.js')
      .action(instrumentAction),
  );

  registerSharedOptions(
    prog
      .command('report')
      .describe('read V8 coverage data from temp and output report')
      .action(reportAction),
  );

  registerSharedOptions(
    prog
      .command('check-coverage')
      .describe('check whether coverage is within thresholds provided')
      .example('check-coverage --lines 95')
      .action(checkCoverageAction),
  );

  // sade's TS for parse options doesn't include mri's `--`, but it forwards it.
  const { handler, args } = prog.parse(process.argv, {
    lazy: true,
    '--': true,
  } as { lazy: true });
  await handler(...args);
}

main().catch((err) => {
  console.error((err as Error).stack);
  process.exitCode = 1;
});
