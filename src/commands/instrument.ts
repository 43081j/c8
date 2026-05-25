import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, rm } from 'node:fs/promises';
import { resolveOptions } from '../options.js';
import { outputReport } from './report.js';

const SPAWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const;

async function spawnInForeground(
  command: string,
  args: string[],
): Promise<[number | null, NodeJS.Signals | null]> {
  const child = spawn(command, args, { stdio: 'inherit' });

  const handlers = SPAWN_SIGNALS.map((sig) => {
    const fn = () => {
      child.kill(sig);
    };
    process.on(sig, fn);
    return [sig, fn] as const;
  });

  const [code, signal] = (await once(child, 'exit')) as [
    number | null,
    NodeJS.Signals | null,
  ];

  for (const [sig, fn] of handlers) {
    process.off(sig, fn);
  }

  return [code, signal];
}

export async function instrumentAction(
  parsed: Record<string, unknown>,
  childArgs: string[],
): Promise<void> {
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

  const [code, signal] = await spawnInForeground(program, programArgs);

  try {
    await outputReport(opts);
  } catch (err) {
    console.error((err as Error).stack);
    process.exit(1);
  }

  if (signal !== null) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
}
