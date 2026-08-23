// Acceptance for the package users actually install, not the worktree.
// Deliberately separate from prepack: this command invokes npm pack itself.

import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const scratch = await mkdtemp(join(tmpdir(), 'dsh-harbor-pack-'));
const packs = join(scratch, 'packs');
const install = join(scratch, 'install');
const fakeHome = join(scratch, 'home');
const fakeDshHome = join(scratch, 'dsh-home');
const npmCache = join(scratch, 'npm-cache');

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}\n${stdout}${stderr}`));
    });
  });
}

try {
  await Promise.all([
    mkdir(packs, { recursive: true }),
    mkdir(install, { recursive: true }),
    mkdir(fakeHome, { recursive: true }),
    mkdir(fakeDshHome, { recursive: true }),
    mkdir(npmCache, { recursive: true }),
  ]);

  // On Windows, invoke npm's JavaScript entry with node instead of passing a
  // .cmd file through a shell. This preserves paths containing spaces or cmd
  // metacharacters and avoids Node's shell:true+args deprecation.
  const npmCli = process.platform === 'win32'
    ? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
    : null;
  if (npmCli) await access(npmCli);
  const runNpm = (args, options = {}) => run(
    npmCli ? process.execPath : 'npm',
    npmCli ? [npmCli, ...args] : args,
    options,
  );
  const packageEnv = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    DSH_HOME: fakeDshHome,
    npm_config_cache: npmCache,
  };
  await runNpm(['pack', '--json', '--pack-destination', packs], { env: packageEnv });
  const archive = (await readdir(packs)).find((name) => name.endsWith('.tgz'));
  if (!archive) throw new Error('npm pack produced no .tgz archive');

  await writeFile(join(install, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2) + '\n');
  await runNpm(['install', '--no-audit', '--no-fund', join(packs, archive)], { cwd: install, env: packageEnv });

  try {
    await access(join(install, 'node_modules', '@deepseek-ai'));
    throw new Error('packed install unexpectedly pulled @deepseek-ai/* packages');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await run(process.execPath, ['--input-type=module', '-e', "await import('@zseven-w/dsh-harbor')"], { cwd: install });

  const installedRoot = join(install, 'node_modules', '@zseven-w', 'dsh-harbor');
  for (const rel of [
    'cordis.patch.yml',
    'lib/client.js',
    'docs/images/dsh-harbor-logo.png',
    'docs/images/dsh-harbor-overview.png',
    'docs/images/dsh-harbor-evidence.png',
    'src/cli.mjs',
    'src/hub/index.mjs',
    'src/hub/freshness.mjs',
  ]) {
    await access(join(installedRoot, rel));
  }
  const clientBundle = await readFile(join(installedRoot, 'lib', 'client.js'), 'utf8');
  if (!clientBundle.includes('//__HARBOR_CLIENT_BUILD__=')) {
    throw new Error('packed lib/client.js has no Harbor build identifier');
  }

  if (process.platform !== 'win32') {
    for (const rel of ['src/hub/index.mjs', 'src/hub/freshness.mjs', 'src/cli.mjs']) {
      const mode = (await stat(join(installedRoot, rel))).mode;
      if ((mode & 0o044) !== 0o044) throw new Error(`${rel} is not readable by a different runtime user`);
    }
  }

  const bin = join(install, 'node_modules', '.bin', process.platform === 'win32' ? 'harbor.cmd' : 'harbor');
  await access(bin);
  const runHarbor = (args) => process.platform === 'win32'
    ? runNpm(['exec', '--', 'harbor', ...args], { cwd: install, env: packageEnv })
    : run(bin, args, { cwd: install, env: packageEnv });
  const version = await runHarbor(['--version']);
  if (version.stdout.trim() !== manifest.version) throw new Error(`unexpected --version output: ${version.stdout}`);

  await runHarbor(['--help']);
  try {
    await access(join(fakeHome, '.config', 'dsh-harbor', 'snapshot.json'));
    throw new Error('--help wrote a snapshot');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const scan = await runHarbor(['scan', '--json', '--no-snapshot']);
  const report = JSON.parse(scan.stdout);
  if (!Array.isArray(report.plugins)) throw new Error('packed CLI returned no plugins array');

  console.log(`packed install smoke passed: ${archive}`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
