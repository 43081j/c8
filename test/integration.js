import { readFileSync, statSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { before, beforeEach, describe, it } from 'node:test';

const nodePath = process.execPath;
const c8Path = resolve(import.meta.dirname, '../bin/c8.js');
const fixture = (p) => resolve(import.meta.dirname, 'fixtures', p);

before(() => rmSync('tmp', { recursive: true, force: true }));

describe('c8', () => {
  it('reports coverage for script that exits normally', (t) => {
    const { output } = spawnSync(nodePath, [
      c8Path,
      '--exclude="test/*.js"',
      '--temp-directory=tmp/normal',
      '--clean=false',
      nodePath,
      fixture('normal.cjs'),
    ]);
    t.assert.snapshot(output.toString('utf8'));
  });

  it('supports externally set NODE_V8_COVERAGE', (t) => {
    const { output } = spawnSync(
      nodePath,
      [
        c8Path,
        '--exclude="test/*.js"',
        '--clean=true',
        nodePath,
        fixture('normal.cjs'),
      ],
      {
        env: {
          NODE_V8_COVERAGE: 'tmp/override',
        },
      },
    );
    const stats = statSync('tmp/override');
    t.assert.equal(stats.isDirectory(), true);
    t.assert.snapshot(output.toString('utf8'));
  });

  it('merges reports from subprocesses together', (t) => {
    const { output } = spawnSync(nodePath, [
      c8Path,
      '--exclude="test/*.js"',
      '--temp-directory=tmp/multiple-spawn',
      '--clean=false',
      nodePath,
      fixture('multiple-spawn.cjs'),
    ]);
    t.assert.snapshot(output.toString('utf8'));
  });

  it('allows relative files to be included', (t) => {
    const { output } = spawnSync(
      nodePath,
      [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=tmp/multiple-spawn-2',
        '--omit-relative=false',
        '--clean=false',
        nodePath,
        fixture('multiple-spawn.cjs'),
      ],
      {
        env: { NODE_DEBUG: 'c8' },
      },
    );
    t.assert.match(
      output.toString('utf8'),
      /Error: ENOENT: no such file or directory.*loader\.js/,
    );
  });

  it('exits with 1 when report output fails', (t) => {
    const { status, stderr } = spawnSync(nodePath, [
      c8Path,
      '--clean=false',
      '--reporter=unknown',
      nodePath,
      '--version',
    ]);
    t.assert.equal(status, 1);
    t.assert.match(stderr.toString(), /Cannot find module 'unknown'/u);
  });

  it('should allow for files outside of cwd', (t) => {
    const { output, status } = spawnSync(
      nodePath,
      [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=tmp/allowExternal',
        '--clean=true',
        '--allowExternal',
        '--reporter=text',
        nodePath,
        fixture('report/allowExternal.cjs'),
      ],
      {
        cwd: dirname(fixture('report/allowExternal.cjs')),
      },
    );
    t.assert.equal(status, 0);
    t.assert.snapshot(output.toString('utf8'));
  });

  it('should allow for multiple overrides of src location for --all', (t) => {
    const { output, status } = spawnSync(
      nodePath,
      [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=../tmp/src',
        '--clean=true',
        '--allowExternal',
        '--reporter=text',
        '--all',
        `--src=${dirname(fixture('multidir1/file1.cjs'))}`,
        `--src=${dirname(fixture('multidir2/file2.cjs'))}`,
        `--src=${dirname(fixture('report/srcOverride.js'))}`,
        nodePath,
        fixture('report/srcOverride.js'),
      ],
      {
        cwd: dirname(fixture('report/srcOverride.js')),
      },
    );
    t.assert.equal(status, 0);
    t.assert.snapshot(output.toString('utf8'));
  });

  describe('check-coverage', () => {
    before(() => {
      spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=tmp/check-coverage',
        '--clean=false',
        nodePath,
        fixture('normal.cjs'),
      ]);
    });

    it('exits with 0 if coverage within threshold', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        'check-coverage',
        '--exclude="test/fixtures/*.js"',
        '--temp-directory=tmp/check-coverage',
        '--lines=70',
        '--branches=55',
        '--statements=70',
      ]);
      t.assert.equal(status, 0);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('exits with 1 if coverage is below threshold', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        'check-coverage',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/check-coverage',
        '--lines=101',
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('allows threshold to be applied on per-file basis', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        'check-coverage',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/check-coverage',
        '--lines=101',
        '--per-file',
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('allows --check-coverage when executing script', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--clean=false',
        '--temp-directory=tmp/check-coverage',
        '--lines=101',
        '--check-coverage',
        nodePath,
        fixture('normal.cjs'),
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('--100', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=tmp/check-coverage',
        '--100',
        nodePath,
        fixture('normal.cjs'),
      ]);

      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('check-coverage command with --100', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        'check-coverage',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/check-coverage',
        '--100',
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('report', () => {
    before(() => {
      spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=./tmp/report',
        '--clean=false',
        nodePath,
        fixture('normal.cjs'),
      ]);
    });

    it('generates report from existing temporary files', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        'report',
        '--exclude="test/*.js"',
        '--temp-directory=./tmp/report',
        '--clean=false',
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('supports --check-coverage, when generating reports', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        'report',
        '--check-coverage',
        '--lines=101',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/report',
        '--clean=false',
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('ESM Modules', () => {
    it('collects coverage for ESM modules', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--clean=false',
        '--temp-directory=tmp/esm',
        nodePath,
        '--experimental-modules',
        '--no-warnings',
        fixture('import.mjs'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('/* c8 ignore next */', () => {
    it('ignores lines with special comment', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--clean=false',
        '--temp-directory=tmp/special-comment',
        nodePath,
        fixture('c8-ignore-next.js'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    // see: https://github.com/bcoe/c8/issues/254
    it('does not incorrectly mark previous branch as uncovered (see #254)', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=tmp/issue-254',
        '--clean=true',
        '--reporter=text',
        nodePath,
        fixture('issue-254.js'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('/* c8 ignore start/stop */', () => {
    it('ignores lines with special comment', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--clean=false',
        '--temp-directory=tmp/start-stop',
        nodePath,
        fixture('c8-ignore-start-stop.js'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('source-maps', () => {
    beforeEach(() =>
      rmSync('tmp/source-map', { recursive: true, force: true }),
    );

    describe('TypeScript', () => {
      // Bugs:
      //   closing '}' on `if` is not covered.
      it('remaps branches', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/branches/branches.typescript.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });

      // Bugs:
      //   closing '}' on `if` is not covered.
      it('remaps classes', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/classes/classes.typescript.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });
    });

    describe('UglifyJS', () => {
      // Bugs:
      //   string in `console.info` shown as uncovered branch.
      it('remaps branches', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/branches/branches.uglify.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });

      // Bugs:
      //   string in `console.info` shown as uncovered branch.
      it('remaps classes', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/classes/classes.uglify.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });
    });

    describe('nyc', () => {
      it('remaps branches', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/branches/branches.nyc.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });

      it('remaps classes', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/classes/classes.nyc.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });
    });
    describe('rollup', () => {
      it('remaps branches', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/branches/branches.rollup.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });

      it('remaps classes', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('source-maps/classes/classes.rollup.js'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });
    });
    describe('ts-node', () => {
      it('reads source-map from cache, and applies to coverage', (t) => {
        const { output } = spawnSync(nodePath, [
          c8Path,
          '--exclude="test/*.js"',
          '--temp-directory=tmp/source-map',
          '--clean=true',
          nodePath,
          fixture('ts-node-basic.ts'),
        ]);
        t.assert.snapshot(output.toString('utf8'));
      });
    });
    // See: https://github.com/bcoe/c8/issues/232
    it("does not attempt to load source map URLs that aren't", (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--temp-directory=tmp/source-map',
        '--clean=true',
        nodePath,
        fixture('source-maps/fake-source-map.js'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });
  describe('--all', () => {
    it('reports coverage for unloaded js files as 0 for line, branch and function', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--temp-directory=tmp/vanilla-all',
        '--clean=false',
        '--all=true',
        '--include=test/fixtures/all/vanilla/**/*.cjs',
        '--exclude=**/*.ts',
        nodePath,
        fixture('all/vanilla/main.cjs'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('reports coverage for unloaded transpiled ts files as 0 for line, branch and function', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--temp-directory=tmp/all-ts',
        '--clean=false',
        '--all=true',
        '--include=test/fixtures/all/ts-compiled/**/*.cjs',
        '--exclude="test/*.js"',
        nodePath,
        fixture('all/ts-compiled/main.cjs'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('reports coverage for unloaded ts files as 0 for line, branch and function when using ts-node', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--temp-directory=tmp/all-ts-node',
        '--clean=false',
        '--all=true',
        '--include=test/fixtures/all/ts-only/**/*.ts',
        '--exclude="test/*.js"',
        nodePath,
        fixture('all/ts-only/main.ts'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('should allow for --all to be used in conjunction with --check-coverage', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--temp-directory=tmp/all-check-coverage',
        '--clean=false',
        '--check-coverage',
        '--lines=100',
        '--all=true',
        '--include=test/fixtures/all/vanilla/**/*.cjs',
        '--exclude=**/*.ts',
        nodePath,
        fixture('all/vanilla/main.cjs'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('should allow for --all to be used with the check-coverage command (2 invocations)', (t) => {
      spawnSync(nodePath, [
        c8Path,
        '--temp-directory=tmp/all-check-coverage-as-command',
        '--clean=false',
        '--check-coverage',
        '--lines=90',
        '--all=true',
        '--include=test/fixtures/all/vanilla/**/*.cjs',
        '--exclude=**/*.ts',
        nodePath,
        fixture('all/vanilla/main.cjs'),
      ]);

      const { output } = spawnSync(nodePath, [
        c8Path,
        'check-coverage',
        '--lines=90',
        '--temp-directory=tmp/all-check-coverage-as-command',
        '--clean=false',
        '--all=true',
        '--include=test/fixtures/all/vanilla/**/*.cjs',
        '--exclude=**/*.ts',
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });
  // see: https://github.com/bcoe/c8/issues/149
  it('cobertura report escapes special characters', (t) => {
    spawnSync(nodePath, [
      c8Path,
      '--exclude="test/*.js"',
      '--temp-directory=tmp/cobertura',
      '--clean=true',
      '--reporter=cobertura',
      nodePath,
      fixture('computed-method.js'),
    ]);
    const cobertura = readFileSync(
      resolve(process.cwd(), './coverage/cobertura-coverage.xml'),
      'utf8',
    )
      .replace(/[0-9]{13,}/, 'nnnn')
      .replace(/<source>.*<\/source>/, '<source>/foo/file</source>')
      .replace(/\\/g, '/');
    t.assert.snapshot(cobertura);
  });
  describe('report', () => {
    it('supports reporting on directories outside cwd', (t) => {
      const { output } = spawnSync(
        nodePath,
        [fixture('report/report-multi-dir-external.cjs')],
        {
          cwd: dirname(fixture('report/report-multi-dir-external.cjs')),
        },
      );
      t.assert.snapshot(output.toString('utf8'));
    });

    it('supports reporting on single directories outside cwd', (t) => {
      const { output } = spawnSync(
        nodePath,
        [fixture('report/report-single-dir-external.cjs')],
        {
          cwd: dirname(fixture('report/report-single-dir-external.cjs')),
        },
      );
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  it('collects coverage for script with shebang', (t) => {
    const { output } = spawnSync(nodePath, [
      c8Path,
      '--exclude="test/*.js"',
      '--temp-directory=tmp/shebang',
      '--clean=false',
      fixture('shebang.js'),
    ]);
    t.assert.snapshot(output.toString('utf8'));
  });

  describe('--exclude-after-remap', () => {
    it('applies exclude rules after source-maps are applied', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--exclude="**/branch-1.js"',
        '--exclude-after-remap',
        '--temp-directory=tmp/source-map',
        '--clean=true',
        nodePath,
        fixture('source-maps/branches/branches.rollup.js'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('--extension', () => {
    it('includes coverage when extensions specified', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--exclude="test/*.js"',
        '--extension=.js',
        '--extension=.special',
        '--temp-directory=tmp/extension',
        '--clean=true',
        nodePath,
        fixture('custom-ext.special'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('includes coverage when extensions specified with --all', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--all',
        '--exclude="test/*.js"',
        '--exclude="tmp/monocart-*/**/*.js"',
        '--extension=.js',
        '--extension=.special',
        '--temp-directory=tmp/extension',
        '--clean=true',
        nodePath,
        fixture('custom-ext.special'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });

  describe('monocart report', () => {
    it('check import monocart', async (t) => {
      const { output, status } = spawnSync(nodePath, [
        './test/fixtures/import-mcr.cjs',
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('monocart check normal', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--experimental-monocart',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/monocart-normal',
        '--reports-dir=tmp/monocart-normal-reports',
        '--reporter=v8',
        '--reporter=console-details',
        '--clean=false',
        nodePath,
        fixture('normal.cjs'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('monocart check all', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--experimental-monocart',
        '--temp-directory=tmp/monocart-vanilla-all',
        '--reports-dir=tmp/monocart-vanilla-all-reports',
        '--reporter=v8',
        '--reporter=console-details',
        '--all',
        '--include=test/fixtures/all/vanilla/**/*.cjs',
        '--exclude=**/*.ts',
        '--clean=false',
        nodePath,
        fixture('all/vanilla/main.cjs'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('monocart check coverage', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        '--experimental-monocart',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/monocart-check-coverage',
        '--reports-dir=tmp/monocart-check-coverage-reports',
        '--reporter=v8',
        '--reporter=console-details',
        '--check-coverage',
        '--statements=80',
        '--branches=80',
        '--lines=80',
        '--clean=false',
        nodePath,
        fixture('normal.cjs'),
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('monocart check coverage pre file', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        '--experimental-monocart',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/monocart-check-per-file',
        '--reports-dir=tmp/monocart-check-per-file-reports',
        '--reporter=v8',
        '--reporter=console-details',
        '--check-coverage',
        '--statements=80',
        '--branches=80',
        '--lines=80',
        '--per-file',
        '--clean=false',
        nodePath,
        fixture('normal.cjs'),
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('monocart check all and 100', (t) => {
      const { output, status } = spawnSync(nodePath, [
        c8Path,
        '--experimental-monocart',
        '--temp-directory=tmp/monocart-all-100',
        '--reports-dir=tmp/monocart-all-100-reports',
        '--reporter=v8',
        '--reporter=console-details',
        '--all',
        '--100',
        '--per-file',
        '--include=test/fixtures/all/vanilla/**/*.cjs',
        '--exclude=**/*.ts',
        '--clean=false',
        nodePath,
        fixture('all/vanilla/main.cjs'),
      ]);
      t.assert.equal(status, 1);
      t.assert.snapshot(output.toString('utf8'));
    });

    it('check sourcemap', (t) => {
      const { output } = spawnSync(nodePath, [
        c8Path,
        '--experimental-monocart',
        '--exclude="test/*.js"',
        '--temp-directory=tmp/monocart-source-map',
        '--reports-dir=tmp/monocart-source-map-reports',
        '--reporter=v8',
        '--reporter=text',
        '--exclude-after-remap',
        '--clean=false',
        nodePath,
        fixture('source-maps/branches/branches.typescript.js'),
      ]);
      t.assert.snapshot(output.toString('utf8'));
    });
  });
});
