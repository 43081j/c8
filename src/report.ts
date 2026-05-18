import Exclude from 'test-exclude'
import libCoverage from 'istanbul-lib-coverage'
import type { CoverageMap, CoverageSummary, FileCoverage } from 'istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports from 'istanbul-reports'
import { mergeProcessCovs, ProcessCov, ScriptCov } from '@bcoe/v8-coverage'
import {readFile} from 'node:fs/promises';
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { isAbsolute, resolve, extname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {getSourceMapFromFile} from './source-map-from-file.js'
// TODO: switch back to @c88/v8-coverage once patch is landed.
import v8toIstanbul from 'v8-to-istanbul'
import util from 'node:util'
import type {
  ReportDescription,
  V8CoverageEntry,
  CoverageReportOptions,
  CoverageResults,
  CoverageSummary as MCRCoverageSummary
} from 'monocart-coverage-reports';

const debuglog = util.debuglog('c8')
const DEFAULT_MAX_COLS = 100

function initialiseMonocartPercentages(
  summary: MCRCoverageSummary
) {
  for (const val of Object.values(summary)) {
    if (val.pct === '') {
      val.pct = 100
    }
  }
}

export interface ReportOptions {
  exclude: string[]
  extension: string | string[]
  excludeAfterRemap: boolean
  include: string[]
  reporter: string[]
  reporterOptions?: Record<string, Record<string, unknown>>
  reportsDirectory: string
  tempDirectory: string
  watermarks: Record<string, [number, number]>
  omitRelative: boolean
  wrapperLength: number
  resolve: string
  all: boolean
  src?: string | string[]
  allowExternal?: boolean
  skipFull: boolean
  excludeNodeModules: boolean
  mergeAsync: boolean
  monocartArgv?: CoverageReportOptions
}

export class Report {
  #reporter: string[]
  #reporterOptions: Record<string, Record<string, unknown>>
  #reportsDirectory: string
  #tempDirectory: string
  #watermarks: Record<string, [number, number]>
  #resolve: string
  #exclude: Exclude
  #excludeAfterRemap: boolean
  #shouldInstrumentCache: Map<string, boolean>
  #omitRelative: boolean
  #sourceMapCache: Record<string, any>
  #wrapperLength: number
  #all: boolean
  #src: string[]
  #skipFull: boolean
  #mergeAsync: boolean
  #monocartArgv: CoverageReportOptions | undefined
  #allCoverageFiles: CoverageMap | undefined = undefined;

  constructor ({
    exclude,
    extension,
    excludeAfterRemap,
    include,
    reporter,
    reporterOptions,
    reportsDirectory,
    tempDirectory,
    watermarks,
    omitRelative,
    wrapperLength,
    resolve: resolvePaths,
    all,
    src,
    allowExternal = false,
    skipFull,
    excludeNodeModules,
    mergeAsync,
    monocartArgv
  }: ReportOptions) {
    this.#reporter = reporter
    this.#reporterOptions = reporterOptions || {}
    this.#reportsDirectory = reportsDirectory
    this.#tempDirectory = tempDirectory
    this.#watermarks = watermarks
    this.#resolve = resolvePaths
    this.#exclude = new Exclude({
      exclude: exclude,
      include: include,
      extension: extension,
      relativePath: !allowExternal,
      excludeNodeModules: excludeNodeModules
    })
    this.#excludeAfterRemap = excludeAfterRemap
    this.#shouldInstrumentCache = new Map()
    this.#omitRelative = omitRelative
    this.#sourceMapCache = {}
    this.#wrapperLength = wrapperLength
    this.#all = all
    this.#skipFull = skipFull
    this.#mergeAsync = mergeAsync
    this.#monocartArgv = monocartArgv

    if (typeof src === 'string') {
      this.#src = [src]
    } else if (Array.isArray(src)) {
      this.#src = src
    } else {
      this.#src = [process.cwd()]
    }
  }

  async run () {
    if (this.#monocartArgv) {
      return this.runMonocart()
    }
    const context = libReport.createContext({
      dir: this.#reportsDirectory,
      watermarks: this.#watermarks,
      coverageMap: await this.getCoverageMapFromAllCoverageFiles()
    })

    for (const _reporter of this.#reporter) {
      reports.create(_reporter, {
        skipEmpty: false,
        skipFull: this.#skipFull,
        maxCols: process.stdout.columns || DEFAULT_MAX_COLS,
        ...this.#reporterOptions[_reporter]
      }).execute(context)
    }
  }

  async importMonocart () {
    return import('monocart-coverage-reports')
  }

  async getMonocart () {
    let MCR
    try {
      MCR = await this.importMonocart()
    } catch (e) {
      console.error('--experimental-monocart requires the plugin monocart-coverage-reports. Run: "npm i monocart-coverage-reports@2 --save-dev"')
      process.exit(1)
    }
    return MCR
  }

  #defaultMonocartEntryFilter = (entry: V8CoverageEntry) => {
    return this.#exclude.shouldInstrument(fileURLToPath(entry.url))
  };

  #defaultMonocartSourceFilter = (sourcePath: string) => {
    if (this.#monocartArgv?.excludeAfterRemap) {
      // console.log(sourcePath)
      return this.#exclude.shouldInstrument(sourcePath)
    }
    return true
  };

  #computeMonocartEntryFilter() {
    const argv = this.#monocartArgv
    if (!argv) {
      return this.#defaultMonocartEntryFilter;
    }
    return argv.entryFilter || argv.filter || this.#defaultMonocartEntryFilter;
  }

  #computeMonocartSourceFilter() {
    const argv = this.#monocartArgv

    if (!argv) {
      return this.#defaultMonocartSourceFilter;
    }
    return argv.sourceFilter || argv.filter || this.#defaultMonocartSourceFilter;
  }

  #getMonocartReports(): ReportDescription[] {
    const argv = this.#monocartArgv;

    if (!argv) {
      return [];
    }

    const reports: unknown[] = Array.isArray(argv.reporter) ? argv.reporter : [argv.reporter]
    const reporterOptions: Record<PropertyKey, unknown> = argv.reporterOptions || {}

    return reports.map((reportName) => {
      const reportOptions = {
        ...reporterOptions[reportName]
      }
      if (reportName === 'text') {
        reportOptions.skipEmpty = false
        reportOptions.skipFull = argv.skipFull
        reportOptions.maxCols = process.stdout.columns || DEFAULT_MAX_COLS
      }
      return [reportName, reportOptions]
    })
  }

  // --all: add empty coverage for all files
  #getMonocartAllOptions() {
    const argv = this.#monocartArgv;

    if (!argv?.all) {
      return undefined;
    }

    const src = argv.src
    const workingDirs: string[] = Array.isArray(src) ? src : (typeof src === 'string' ? [src] : [process.cwd()])
    return {
      dir: workingDirs,
      filter: (filePath: string) => {
        return this.#exclude.shouldInstrument(filePath)
      }
    }
  }

  #onMonocartEnd = (coverageResults: CoverageResults | undefined) => {
    if (!coverageResults) {
      return
    }

    // for check coverage
    this.#allCoverageFiles = {
      files: () => {
        return coverageResults.files.map(it => it.sourcePath)
      },
      fileCoverageFor: (file: string) => {
        const fileCoverage = coverageResults.files.find(it => it.sourcePath === file)

        if (!fileCoverage) {
          throw new Error(`No file coverage found for ${file}`)
        }

        return {
          toSummary: () => {
            initialiseMonocartPercentages(fileCoverage.summary);
            return fileCoverage.summary;
          }
        } as unknown as FileCoverage
      },
      getCoverageSummary: () => {
        initialiseMonocartPercentages(coverageResults.summary);
        return coverageResults.summary as unknown as CoverageSummary;
      }
    } as unknown as CoverageMap;
  };

  async runMonocart () {
    const MCR = await this.getMonocart()
    if (!MCR) {
      return
    }

    const argv = this.#monocartArgv

    if (!argv) {
      return
    }

    // adapt coverage options
    const coverageOptions: CoverageReportOptions = {
      logging: argv.logging,
      name: argv.name,

      reports: this.#getMonocartReports(),

      outputDir: argv.reportsDir,
      baseDir: argv.baseDir,

      entryFilter: this.#computeMonocartEntryFilter(),
      sourceFilter: this.#computeMonocartSourceFilter(),

      inline: argv.inline,
      lcov: argv.lcov,

      all: this.#getMonocartAllOptions(),

      clean: argv.clean,

      // use default value for istanbul
      defaultSummarizer: 'pkg',

      onEnd: this.#onMonocartEnd
    }

    const coverageReport = new MCR.CoverageReport(coverageOptions)
    coverageReport.cleanCache()

    // read v8 coverage data from tempDirectory
    await coverageReport.addFromDir(argv.tempDirectory)

    // generate report
    await coverageReport.generate()
  }

  async getCoverageMapFromAllCoverageFiles () {
    // the merge process can be very expensive, and it's often the case that
    // check-coverage is called immediately after a report. We memoize the
    // result from getCoverageMapFromAllCoverageFiles() to address this
    // use-case.
    if (this.#allCoverageFiles) {
      return this.#allCoverageFiles
    }

    const map = libCoverage.createCoverageMap()
    let v8ProcessCov: ProcessCov | null = null

    if (this.#mergeAsync) {
      v8ProcessCov = await this._getMergedProcessCovAsync()
    } else {
      v8ProcessCov = this._getMergedProcessCov()
    }
    const resultCountPerPath = new Map()

    if (v8ProcessCov) {
      for (const v8ScriptCov of v8ProcessCov.result) {
        try {
          const sources = this._getSourceMap(v8ScriptCov)
          const path = resolve(this.#resolve, v8ScriptCov.url)
          const converter = v8toIstanbul(path, this.#wrapperLength, sources, (path) => {
            if (this.#excludeAfterRemap) {
              return !this._shouldInstrument(path)
            }
          })
          await converter.load()

          if (resultCountPerPath.has(path)) {
            resultCountPerPath.set(path, resultCountPerPath.get(path) + 1)
          } else {
            resultCountPerPath.set(path, 0)
          }

          converter.applyCoverage(v8ScriptCov.functions)
          map.merge(converter.toIstanbul())
        } catch (err) {
          const stack = err instanceof Error ? err.stack : String(err)
          debuglog(`file: ${v8ScriptCov.url} error: ${stack}`)
        }
      }
    }

    this.#allCoverageFiles = map
    return this.#allCoverageFiles
  }

  /**
   * Returns source-map and fake source file, if cached during Node.js'
   * execution. This is used to support tools like ts-node, which transpile
   * using runtime hooks.
   *
   * Note: requires Node.js 13+
   *
   * @return {Object} sourceMap and fake source file (created from line #s).
   * @private
   */
  _getSourceMap (v8ScriptCov: ScriptCov) {
    const sources: {
      source: string
      originalSource?: string
      sourceMap?: { sourcemap: unknown }
    } = {
      source: ''
    };
    const sourceMapAndLineLengths = this.#sourceMapCache[pathToFileURL(v8ScriptCov.url).href]
    if (sourceMapAndLineLengths) {
      // See: https://github.com/nodejs/node/pull/34305
      if (!sourceMapAndLineLengths.data) return
      sources.sourceMap = {
        sourcemap: sourceMapAndLineLengths.data
      }
      if (sourceMapAndLineLengths.lineLengths) {
        let source = ''
        sourceMapAndLineLengths.lineLengths.forEach(length => {
          source += `${''.padEnd(length, '.')}\n`
        })
        sources.source = source
      }
    }
    return sources
  }

  /**
   * Returns the merged V8 process coverage.
   *
   * The result is computed from the individual process coverages generated
   * by Node. It represents the sum of their counts.
   *
   * @return {ProcessCov} Merged V8 process coverage.
   * @private
   */
  _getMergedProcessCov (): ProcessCov {
    const v8ProcessCovs = []
    const fileIndex = new Set() // Set<string>
    for (const v8ProcessCov of this._loadReports()) {
      if (this._isCoverageObject(v8ProcessCov)) {
        if (v8ProcessCov['source-map-cache']) {
          Object.assign(this.#sourceMapCache, this._normalizeSourceMapCache(v8ProcessCov['source-map-cache']))
        }
        v8ProcessCovs.push(this._normalizeProcessCov(v8ProcessCov, fileIndex))
      }
    }

    if (this.#all) {
      const emptyReports = this._includeUncoveredFiles(fileIndex)
      v8ProcessCovs.unshift({
        result: emptyReports
      })
    }

    return mergeProcessCovs(v8ProcessCovs)
  }

  /**
   * Returns the merged V8 process coverage.
   *
   * It asynchronously and incrementally reads and merges individual process coverages
   * generated by Node. This can be used via the `--merge-async` CLI arg.  It's intended
   * to be used across a large multi-process test run.
   *
   * @return {ProcessCov} Merged V8 process coverage.
   * @private
   */
  async _getMergedProcessCovAsync (): Promise<ProcessCov | null> {
    const fileIndex = new Set() // Set<string>
    let mergedCov = null
    for (const file of readdirSync(this.#tempDirectory)) {
      try {
        const rawFile = await readFile(
          resolve(this.#tempDirectory, file),
          'utf8'
        )
        let report = JSON.parse(rawFile)

        if (this._isCoverageObject(report)) {
          if (report['source-map-cache']) {
            Object.assign(this.#sourceMapCache, this._normalizeSourceMapCache(report['source-map-cache']))
          }
          report = this._normalizeProcessCov(report, fileIndex)
          if (mergedCov) {
            mergedCov = mergeProcessCovs([mergedCov, report])
          } else {
            mergedCov = mergeProcessCovs([report])
          }
        }
      } catch (err) {
        const stack = err instanceof Error ? err.stack : String(err)
        debuglog(`${stack}`)
      }
    }

    if (this.#all && mergedCov) {
      const emptyReports = this._includeUncoveredFiles(fileIndex)
      const emptyReport = {
        result: emptyReports
      }

      mergedCov = mergeProcessCovs([emptyReport, mergedCov])
    }

    return mergedCov
  }

  /**
   * Adds empty coverage reports to account for uncovered/untested code.
   * This is only done when the `--all` flag is present.
   *
   * @param {Set} fileIndex list of files that have coverage
   * @returns {Array} list of empty coverage reports
   */
  _includeUncoveredFiles (fileIndex) {
    const emptyReports = []
    const workingDirs = this.#src
    const { extension } = this.#exclude
    for (const workingDir of workingDirs) {
      this.#exclude.globSync(workingDir).forEach((f) => {
        const fullPath = resolve(workingDir, f)
        if (!fileIndex.has(fullPath)) {
          const ext = extname(fullPath)
          if (extension.includes(ext)) {
            const stat = statSync(fullPath)
            const sourceMap = getSourceMapFromFile(fullPath)
            if (sourceMap) {
              this.#sourceMapCache[pathToFileURL(fullPath)] = { data: sourceMap }
            }
            emptyReports.push({
              scriptId: 0,
              url: resolve(fullPath),
              functions: [{
                functionName: '(empty-report)',
                ranges: [{
                  startOffset: 0,
                  endOffset: stat.size,
                  count: 0
                }],
                isBlockCoverage: true
              }]
            })
          }
        }
      })
    }

    return emptyReports
  }

  /**
   * Make sure v8ProcessCov actually contains coverage information.
   *
   * @return {boolean} does it look like v8ProcessCov?
   * @private
   */
  _isCoverageObject (maybeV8ProcessCov) {
    return maybeV8ProcessCov && Array.isArray(maybeV8ProcessCov.result)
  }

  /**
   * Returns the list of V8 process coverages generated by Node.
   *
   * @return {ProcessCov[]} Process coverages generated by Node.
   * @private
   */
  _loadReports () {
    const reports = []
    for (const file of readdirSync(this.#tempDirectory)) {
      try {
        reports.push(JSON.parse(readFileSync(
          resolve(this.#tempDirectory, file),
          'utf8'
        )))
      } catch (err) {
        debuglog(`${err.stack}`)
      }
    }
    return reports
  }

  /**
   * Normalizes a process coverage.
   *
   * This function replaces file URLs (`url` property) by their corresponding
   * system-dependent path and applies the current inclusion rules to filter out
   * the excluded script coverages.
   *
   * The result is a copy of the input, with script coverages filtered based
   * on their `url` and the current inclusion rules.
   * There is no deep cloning.
   *
   * @param v8ProcessCov V8 process coverage to normalize.
   * @param fileIndex a Set<string> of paths discovered in coverage
   * @return {v8ProcessCov} Normalized V8 process coverage.
   * @private
   */
  _normalizeProcessCov (v8ProcessCov, fileIndex) {
    const result = []
    for (const v8ScriptCov of v8ProcessCov.result) {
      // https://github.com/nodejs/node/pull/35498 updates Node.js'
      // builtin module filenames:
      if (/^node:/.test(v8ScriptCov.url)) {
        v8ScriptCov.url = `${v8ScriptCov.url.replace(/^node:/, '')}.js`
      }
      if (/^file:\/\//.test(v8ScriptCov.url)) {
        try {
          v8ScriptCov.url = fileURLToPath(v8ScriptCov.url)
          fileIndex.add(v8ScriptCov.url)
        } catch (err) {
          debuglog(`${err.stack}`)
          continue
        }
      }
      if ((!this.#omitRelative || isAbsolute(v8ScriptCov.url))) {
        if (this.#excludeAfterRemap || this._shouldInstrument(v8ScriptCov.url)) {
          result.push(v8ScriptCov)
        }
      }
    }
    return { result }
  }

  /**
   * Normalizes a V8 source map cache.
   *
   * This function normalizes file URLs to a system-independent format.
   *
   * @param v8SourceMapCache V8 source map cache to normalize.
   * @return {v8SourceMapCache} Normalized V8 source map cache.
   * @private
   */
  _normalizeSourceMapCache (v8SourceMapCache) {
    const cache = {}
    for (const fileURL of Object.keys(v8SourceMapCache)) {
      cache[pathToFileURL(fileURLToPath(fileURL)).href] = v8SourceMapCache[fileURL]
    }
    return cache
  }

  /**
   * this.exclude.shouldInstrument with cache
   *
   * @private
   * @return {boolean}
   */
  _shouldInstrument (filename) {
    const cacheResult = this.#shouldInstrumentCache.get(filename)
    if (cacheResult !== undefined) {
      return cacheResult
    }

    const result = this.#exclude.shouldInstrument(filename)
    this.#shouldInstrumentCache.set(filename, result)
    return result
  }
}
