import type { CoverageReportOptions } from 'monocart-coverage-reports';
import { Report } from '../report.js';
import { resolveOptions } from '../options.js';
import type { CliOptions } from '../options.js';
import { checkCoverages } from './check-coverage.js';

export async function outputReport(opts: CliOptions): Promise<void> {
  const useMonocart =
    opts.experimentalMonocart ||
    process.env.EXPERIMENTAL_MONOCART !== undefined;

  const report = new Report({
    include: opts.include,
    exclude: opts.exclude,
    extension: opts.extension,
    excludeAfterRemap: opts.excludeAfterRemap,
    reporter: opts.reporter,
    reportsDirectory: opts.reportsDirectory,
    reporterOptions: opts.reporterOptions ?? {},
    tempDirectory: opts.tempDirectory,
    watermarks: opts.watermarks,
    resolve: opts.resolve,
    omitRelative: opts.omitRelative,
    wrapperLength: opts.wrapperLength,
    all: opts.all,
    allowExternal: opts.allowExternal,
    src: opts.src,
    skipFull: opts.skipFull,
    excludeNodeModules: opts.excludeNodeModules,
    monocartArgv: useMonocart
      ? (opts as unknown as CoverageReportOptions)
      : undefined,
  });
  await report.run();
  if (opts.checkCoverage) await checkCoverages(opts, report);
}

export async function reportAction(
  parsed: Record<string, unknown>,
): Promise<void> {
  await outputReport(resolveOptions(parsed));
}
