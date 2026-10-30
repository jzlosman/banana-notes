import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function positiveInteger(name, fallback) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

const totalRuns = positiveInteger('MARKDOWN_PBT_RUNS', 300);
const batchSize = positiveInteger('MARKDOWN_PBT_BATCH_RUNS', 1000);
const tsx = fileURLToPath(new URL('../node_modules/tsx/dist/cli.mjs', import.meta.url));
let completed = 0;

while (completed < totalRuns) {
  const runs = Math.min(batchSize, totalRuns - completed);
  const batch = Math.floor(completed / batchSize) + 1;
  const batches = Math.ceil(totalRuns / batchSize);
  console.log(`Markdown property batch ${batch}/${batches}: ${runs} runs per property`);

  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, '--test', 'web/tests/markdown-roundtrip.test.ts', 'web/tests/viewer-editing-pbt.test.ts'], {
      cwd: process.cwd(),
      env: { ...process.env, MARKDOWN_PBT_RUNS: String(runs) },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('close', (exitCode, signal) => {
      resolve(exitCode ?? (signal ? 1 : 0));
    });
  });

  if (code !== 0) process.exit(typeof code === 'number' ? code : 1);
  completed += runs;
}
