import path from 'node:path';
import { glob } from 'glob';
import { minimatch } from 'minimatch';

const isOutsideDir = (dir: string, file: string): boolean => {
    const relative = path.relative(dir, file);
    return (
        relative === '' ||
        relative.startsWith('..' + path.sep) ||
        relative === '..'
    );
};

export interface TestExcludeOptions {
  include?: readonly string[];
  exclude?: readonly string[];
  cwd?: string;
  extension?: readonly string[];
  excludeNodeModules?: boolean;
  relativePath?: boolean;
}

const DEFAULT_EXTENSIONS = [
	'.js',
	'.cjs',
	'.mjs',
	'.ts',
	'.tsx',
	'.jsx'
];
const DEFAULT_EXTENSIONS_STRING = DEFAULT_EXTENSIONS.map(ext => ext.slice(1)).join(',');
const DEFAULT_EXCLUDE = [
	'coverage/**',
	'packages/*/test{,s}/**',
	'**/*.d.ts',
	'test{,s}/**',
	`test{,-*}.{${DEFAULT_EXTENSIONS_STRING}}`,
	`**/*{.,-}test.{${DEFAULT_EXTENSIONS_STRING}}`,
	'**/__tests__/**',
	'**/{ava,babel,nyc}.config.{js,cjs,mjs}',
	'**/jest.config.{js,cjs,mjs,ts}',
	'**/{karma,rollup,webpack}.config.js',
	'**/.{eslint,mocha}rc.{js,cjs}'
];
const LEADING_DOT_SPECIFIER = /^\.[\\/]/;

export class TestExclude {
    relativePath: boolean = true;
    cwd: string = process.cwd();
    exclude: readonly string[] = DEFAULT_EXCLUDE;
    excludeNodeModules: boolean = true;
    include: readonly string[] = [];
    extension: readonly string[] = DEFAULT_EXTENSIONS;

    constructor(opts: TestExcludeOptions = {}) {
    if (opts.include !== undefined) {
        this.include = opts.include;
    }
    if (opts.exclude !== undefined) {
        this.exclude = opts.exclude;
    }
    if (opts.cwd !== undefined) {
        this.cwd = opts.cwd;
    }
    if (opts.extension !== undefined) {
        this.extension = opts.extension;
    }
    if (opts.excludeNodeModules !== undefined) {
        this.excludeNodeModules = opts.excludeNodeModules;
    }
    if (opts.relativePath !== undefined) {
        this.relativePath = opts.relativePath;
    }

        if (
            this.excludeNodeModules &&
            !this.exclude.includes('**/node_modules/**')
        ) {
      this.exclude = [...this.exclude, '**/node_modules/**'];
        }

    this.#validateLegacyIncludeNegations();
    }

  #validateLegacyIncludeNegations() {
    if (this.include.some(e => e.charAt(0) === '!')) {
      console.warn(
        'Negated patterns in the "include" option are not supported. Please move them to the "exclude" option.',
      );
    }
  }

    shouldInstrument(filename: string, relFile?: string) {
        if (
      this.extension.length > 0 &&
            !this.extension.some(ext => filename.endsWith(ext))
        ) {
            return false;
        }

        let pathToCheck = filename;

        if (this.relativePath) {
            relFile = relFile || path.relative(this.cwd, filename);

            // Don't instrument files that are outside of the current working directory.
            if (isOutsideDir(this.cwd, filename)) {
                return false;
            }

            pathToCheck = relFile.replace(LEADING_DOT_SPECIFIER, ''); // remove leading './' or '.\'.
        }

        const dot = { dot: true };
        const matches = (pattern: string) => minimatch(pathToCheck, pattern, dot);
        return (
            (this.include.length === 0 || this.include.some(matches)) &&
            !this.exclude.some(matches)
        );
    }

    globSync(cwd: string = this.cwd): readonly string[] {
        const globPatterns = getExtensionPattern(this.extension || []);
        const globOptions = { cwd, nodir: true, dot: true, posix: true, ignore: this.exclude };

        return glob
            .sync(globPatterns, globOptions)
            .filter((file: string) => this.shouldInstrument(path.resolve(cwd, file)));
    }

    async glob(cwd = this.cwd): Promise<readonly string[]> {
        const globPatterns = getExtensionPattern(this.extension);
        const globOptions = { cwd, nodir: true, dot: true, posix: true, ignore: this.exclude };

        const list = await glob(globPatterns, globOptions);
        return list.filter((file: string) => this.shouldInstrument(path.resolve(cwd, file)));
    }
}

function getExtensionPattern(extension: readonly string[]): string {
    switch (extension.length) {
        case 0:
            return '**';
        case 1:
            return `**/*${extension[0]}`;
        default:
            return `**/*{${extension.join()}}`;
    }
}
