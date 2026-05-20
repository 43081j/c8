import { relative } from 'node:path';
import { Report } from '../report.js';
import { resolveOptions } from '../options.js';
import type { CliOptions } from '../options.js';

interface Thresholds {
  lines: number;
  functions: number;
  branches: number;
  statements: number;
}

interface Summary {
  lines: { pct: number };
  functions: { pct: number };
  branches: { pct: number };
  statements: { pct: number };
}

export async function checkCoverageAction(
  parsed: Record<string, unknown>,
): Promise<void> {
  const opts = resolveOptions(parsed);
  const report = new Report({
    include: opts.include,
    exclude: opts.exclude,
    extension: opts.extension,
    excludeAfterRemap: opts.excludeAfterRemap,
    reporter: opts.reporter,
    reportsDirectory: opts.reportsDirectory,
    reporterOptions: opts.reporterOptions,
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
    mergeAsync: opts.mergeAsync,
  });
  await checkCoverages(opts, report);
}

export async function checkCoverages(
  opts: CliOptions,
  report: Report,
): Promise<void> {
  const thresholds: Thresholds = {
    lines: opts.lines,
    functions: opts.functions,
    branches: opts.branches,
    statements: opts.statements,
  };
  const map = await report.getCoverageMapFromAllCoverageFiles();
  if (opts.perFile) {
    for (const file of map.files()) {
      checkCoverage(
        map.fileCoverageFor(file).toSummary() as unknown as Summary,
        thresholds,
        file,
      );
    }
  } else {
    checkCoverage(map.getCoverageSummary() as unknown as Summary, thresholds);
  }
}

function checkCoverage(
  summary: Summary,
  thresholds: Thresholds,
  file?: string,
): void {
  for (const key of Object.keys(thresholds) as Array<keyof Thresholds>) {
    const coverage = summary[key].pct;
    if (coverage >= thresholds[key]) continue;

    process.exitCode = 1;
    if (file) {
      console.error(
        `ERROR: Coverage for ${key} (${coverage}%) does not meet threshold (${thresholds[key]}%) for ${relative('./', file).replace(/\\/g, '/')}`,
      );
    } else {
      console.error(
        `ERROR: Coverage for ${key} (${coverage}%) does not meet global threshold (${thresholds[key]}%)`,
      );
    }
  }
}
