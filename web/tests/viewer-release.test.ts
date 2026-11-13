import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

type Workflow = {
  on?: {
    push?: { tags?: string[] };
    workflow_dispatch?: unknown;
  };
  jobs?: Record<string, { if?: string; steps?: Array<{ name?: string; if?: string; run?: string }> }>;
};

function readWorkflow(filename: string): { workflow: Workflow; source: string } {
  const source = readFileSync(resolve(repositoryRoot, '.github/workflows', filename), 'utf8');
  return { workflow: parse(source) as Workflow, source };
}

function githubTagMatches(pattern: string, tag: string): boolean {
  const expression = pattern
    .replace(/[.+^${}()|\\]/g, '\\$&')
    .replace(/\[([^\]]+)\]/g, '[$1]')
    .replaceAll('*', '.*');
  return new RegExp(`^${expression}$`).test(tag);
}

const mockTeamId = 'TEAMID0001';
const bundleIds = {
  notes: 'com.jzlosman.banana-notes',
  viewer: 'com.jzlosman.banana-viewer',
  tasks: 'com.jzlosman.banana-tasks',
};

type Product = 'notes' | 'viewer' | 'tasks';
type FixtureOptions = { notesBundleId?: string; viewerBundleId?: string; tasksBundleId?: string };
type PackagerOverrides = { args?: string[]; env?: Record<string, string>; unset?: string[] };

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function runGit(repository: string, ...args: string[]): string {
  return execFileSync('git', ['-C', repository, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
}

function addPlistString(plistPath: string, key: string, value: string): void {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string "${value}"`, plistPath]);
}

function createApp(root: string, product: Product, bundleId: string, version: string): void {
  const name = { notes: 'Banana Notes', viewer: 'Banana Viewer', tasks: 'Banana Tasks' }[product];
  const plistPath = join(root, 'build', `${name}.app`, 'Contents', 'Info.plist');
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict/></plist>');
  addPlistString(plistPath, 'CFBundleName', name);
  addPlistString(plistPath, 'CFBundleIdentifier', bundleId);
  addPlistString(plistPath, 'CFBundleExecutable', name);
  addPlistString(plistPath, 'CFBundleShortVersionString', version);
  addPlistString(plistPath, 'CFBundleVersion', '42');
}

function createPackagerFixture(options: FixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), 'banana-release-test-'));
  const scriptDirectory = join(root, 'scripts');
  const fakeBin = join(root, 'fake-bin');
  const tempDirectory = join(root, 'tmp');
  mkdirSync(scriptDirectory);
  mkdirSync(fakeBin);
  mkdirSync(tempDirectory);
  const packageScript = join(scriptDirectory, 'package-release.sh');
  writeFileSync(packageScript, readFileSync(resolve(repositoryRoot, 'scripts/package-release.sh')));

  createApp(root, 'notes', options.notesBundleId ?? bundleIds.notes, '1.2.3');
  createApp(root, 'viewer', options.viewerBundleId ?? bundleIds.viewer, '0.1.1');
  mkdirSync(join(root, 'tasks'));
  writeFileSync(join(root, 'tasks', 'version.txt'), '0.3.0\n');
  createApp(root, 'tasks', options.tasksBundleId ?? bundleIds.tasks, '0.3.0');

  writeExecutable(join(fakeBin, 'codesign'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == "-dv" ]]; then
  flags='flags=0x0'
  if [[ "\${FAKE_HARDENED_RUNTIME:-1}" == '1' ]]; then flags='flags=0x10000(runtime)'; fi
  printf 'Identifier=%s\\n%s\\nTeamIdentifier=%s\\n' "\${FAKE_BUNDLE_ID}" "$flags" "\${FAKE_TEAM_ID}" >&2
fi
exit 0
`);
  writeExecutable(join(fakeBin, 'xcrun'), `#!/bin/bash
set -euo pipefail
if [[ "\${1:-}" == 'notarytool' && "\${2:-}" == 'submit' ]]; then
  printf 'submit\\n' >> "$MOCK_NETWORK_LOG"
fi
exit 0
`);
  writeExecutable(join(fakeBin, 'ditto'), `#!/bin/bash
set -euo pipefail
destination=''
for argument in "$@"; do destination="$argument"; done
mkdir -p "$(dirname "$destination")"
printf 'mock archive\\n' > "$destination"
`);
  writeExecutable(join(fakeBin, 'hdiutil'), `#!/bin/bash
set -euo pipefail
destination=''
for argument in "$@"; do destination="$argument"; done
mkdir -p "$(dirname "$destination")"
printf 'mock disk image\\n' > "$destination"
`);
  writeExecutable(join(fakeBin, 'spctl'), '#!/bin/bash\nexit 0\n');

  const notaryKeyPath = join(root, 'mock-notary-key.p8');
  const networkLogPath = join(root, 'mock-network-submissions.log');
  writeFileSync(notaryKeyPath, 'synthetic test key; not a credential');
  const baseEnvironment: Record<string, string> = {
    PATH: [fakeBin, '/usr/bin:/bin:/usr/sbin:/sbin'].join(delimiter),
    HOME: root,
    TMPDIR: tempDirectory,
    LC_ALL: 'C',
    SIGN_IDENTITY: `Developer ID Application: Mock (${mockTeamId})`,
    APPLE_TEAM_ID: mockTeamId,
    NOTARY_KEY_PATH: notaryKeyPath,
    NOTARY_KEY_ID: 'mock-key-id',
    NOTARY_ISSUER: 'mock-issuer-id',
    MOCK_NETWORK_LOG: networkLogPath,
    FAKE_TEAM_ID: mockTeamId,
    FAKE_HARDENED_RUNTIME: '1',
  };

  return {
    root,
    packageScript,
    networkLogPath,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    clearNetworkLog: () => rmSync(networkLogPath, { force: true }),
    networkSubmissions: () => existsSync(networkLogPath) ? readFileSync(networkLogPath, 'utf8').trim().split('\n').filter(Boolean) : [],
    run({ args = [], env = {}, unset = [] }: PackagerOverrides = {}) {
      const product: Product = args[0] === 'viewer' ? 'viewer' : args[0] === 'tasks' ? 'tasks' : 'notes';
      const childEnvironment: Record<string, string> = {
        ...baseEnvironment,
        FAKE_BUNDLE_ID: bundleIds[product],
        ...env,
      };
      for (const key of unset) delete childEnvironment[key];
      return spawnSync('/bin/bash', [packageScript, ...args], {
        cwd: root,
        env: childEnvironment,
        encoding: 'utf8',
      });
    },
  };
}

test('Notes, Viewer, and Tasks release tag filters are disjoint', () => {
  const notes = readWorkflow('release.yml').workflow;
  const viewer = readWorkflow('viewer-release.yml').workflow;
  const tasks = readWorkflow('tasks-release.yml').workflow;
  const notesTags = notes.on?.push?.tags ?? [];
  const viewerTags = viewer.on?.push?.tags ?? [];
  const tasksTags = tasks.on?.push?.tags ?? [];

  assert.deepEqual(notesTags, ['v[0-9]*']);
  assert.deepEqual(viewerTags, ['viewer-v[0-9]*']);
  assert.deepEqual(tasksTags, ['tasks-v[0-9]*']);
  assert.ok(notes.on?.workflow_dispatch !== undefined);
  assert.ok(viewer.on?.workflow_dispatch !== undefined);
  assert.ok(tasks.on?.workflow_dispatch !== undefined);
  assert.equal(notesTags.some(pattern => githubTagMatches(pattern, 'viewer-v0.1.1')), false);
  assert.equal(notesTags.some(pattern => githubTagMatches(pattern, 'tasks-v0.3.0')), false);
  assert.equal(viewerTags.some(pattern => githubTagMatches(pattern, 'v0.2.7')), false);
  assert.equal(viewerTags.some(pattern => githubTagMatches(pattern, 'tasks-v0.3.0')), false);
  assert.equal(tasksTags.some(pattern => githubTagMatches(pattern, 'v0.2.7')), false);
  assert.equal(tasksTags.some(pattern => githubTagMatches(pattern, 'viewer-v0.1.1')), false);
  assert.equal(notesTags.some(pattern => githubTagMatches(pattern, 'v0.2.7')), true);
  assert.equal(viewerTags.some(pattern => githubTagMatches(pattern, 'viewer-v0.1.1')), true);
  assert.equal(tasksTags.some(pattern => githubTagMatches(pattern, 'tasks-v0.3.0')), true);
});

test('Viewer release is versioned independently and only creates a draft without Notes updater assets', () => {
  const { workflow, source } = readWorkflow('viewer-release.yml');
  const publish = workflow.jobs?.['publish-draft'];
  const buildSteps = workflow.jobs?.build?.steps ?? [];

  assert.match(source, /viewer\/version\.txt/);
  assert.doesNotMatch(source, /package\.json|appcast\.xml|Sparkle/);
  assert.match(source, /Banana-Viewer-\$\{version\}\.dmg/);
  assert.match(source, /Banana-Viewer-\$\{version\}\.zip/);
  assert.match(source, /build\/viewer-release\/SHA256SUMS/);
  assert.match(source, /--latest=false/);
  assert.equal(publish?.if, "github.event_name == 'push'");
  assert.ok(buildSteps.some(step => step.name === 'Build universal viewer app'));
  assert.ok(buildSteps.some(step => step.name === 'Package and notarize viewer' && step.if === "github.event_name == 'push'"));
  assert.ok(buildSteps.some(step => step.name === 'Import Developer ID certificate' && step.if === "github.event_name == 'push'"));
  const releaseGuide = readFileSync(resolve(repositoryRoot, 'docs/viewer-releases.md'), 'utf8');
  assert.match(releaseGuide, /gh release edit viewer-v0\.1\.1 --draft=false --latest=false/);
});

test('Tasks workflow validates its source-version tag and limits manual dispatch to verification', (t) => {
  const { workflow, source } = readWorkflow('tasks-release.yml');
  const buildSteps = workflow.jobs?.build?.steps ?? [];
  const publish = workflow.jobs?.['publish-draft'];
  const versionScript = buildSteps.find(step => step.name === 'Resolve Tasks release version')?.run;
  assert.ok(versionScript, 'the workflow must validate the Tasks-owned version source');

  const root = mkdtempSync(join(tmpdir(), 'banana-tasks-release-workflow-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'tasks'));
  writeFileSync(join(root, 'tasks', 'version.txt'), '0.3.0\n');
  const runVersionCheck = (eventName: string, refName: string, outputName: string) => spawnSync(
    '/bin/bash', ['-euo', 'pipefail', '-c', versionScript], {
      cwd: root,
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_REF_NAME: refName,
        GITHUB_RUN_NUMBER: '17',
        GITHUB_ENV: join(root, outputName),
      },
      encoding: 'utf8',
    },
  );
  let result = runVersionCheck('push', 'tasks-v0.3.0', 'tag.env');
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(root, 'tag.env'), 'utf8'), /TASKS_VERSION=0\.3\.0/);
  result = runVersionCheck('push', 'tasks-v0.3.1', 'mismatch.env');
  assert.notEqual(result.status, 0, 'a mismatched Tasks tag must fail closed');
  result = runVersionCheck('workflow_dispatch', 'refs/heads/feature', 'manual.env');
  assert.equal(result.status, 0, result.stderr);

  assert.ok(buildSteps.some(step => step.name === 'Test Tasks native adapters' && step.run === 'npm run test:tasks:native'));
  assert.ok(buildSteps.some(step => step.name === 'Build universal Tasks app'));
  assert.ok(buildSteps.some(step => step.name === 'Test actual bundled WebKit with denied capabilities' &&
    step.run?.includes('build/Banana Tasks.app/Contents/Resources/web')));
  assert.equal(buildSteps.find(step => step.name === 'Import Developer ID certificate')?.if, "github.event_name == 'push'");
  assert.equal(buildSteps.find(step => step.name === 'Package and notarize Tasks')?.if, "github.event_name == 'push'");
  assert.equal(buildSteps.find(step => step.name === 'Upload Tasks release assets for draft creation')?.if, "github.event_name == 'push'");
  assert.equal(publish?.if, "github.event_name == 'push'");
  assert.match(source, /tasks\/version\.txt/);
  assert.match(source, /--draft\s+/);
  assert.match(source, /--latest=false/);
  assert.match(source, /Banana-Tasks-\$\{version\}\.dmg/);
  assert.match(source, /Banana-Tasks-\$\{version\}\.zip/);
  assert.match(source, /build\/tasks-release\/SHA256SUMS/);
  assert.doesNotMatch(source, /appcast\.xml|Sparkle|Banana-(?:Notes|Viewer)|build\/(?:release|viewer-release)/);
  assert.doesNotMatch(source, /--draft=false/);
});

test('Tasks ancestry guard accepts main ancestors, rejects feature commits, and skips manual verification', (t) => {
  const { workflow } = readWorkflow('tasks-release.yml');
  const steps = workflow.jobs?.build?.steps ?? [];
  const guard = steps.find(step => step.name === 'Verify release source is contained on origin/main');
  const guardScript = guard?.run;
  assert.equal(guard?.if, "github.event_name == 'push'");
  assert.ok(guardScript);
  assert.ok(steps.findIndex(step => step.name === 'Verify release source is contained on origin/main') <
    steps.findIndex(step => step.name === 'Import Developer ID certificate'), 'ancestry must be checked before signing credentials are loaded');

  const root = mkdtempSync(join(tmpdir(), 'banana-tasks-ancestry-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const checkout = join(root, 'checkout');
  execFileSync('git', ['init', '--bare', origin], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  execFileSync('git', ['init', checkout], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  runGit(checkout, 'checkout', '-b', 'main');
  runGit(checkout, 'config', 'user.name', 'Synthetic Release Guard');
  runGit(checkout, 'config', 'user.email', 'release-guard@example.invalid');
  writeFileSync(join(checkout, 'main.txt'), 'base\n');
  runGit(checkout, 'add', 'main.txt');
  runGit(checkout, 'commit', '-m', 'main base');
  const baseSha = runGit(checkout, 'rev-parse', 'HEAD').trim();
  writeFileSync(join(checkout, 'main.txt'), 'main advance\n');
  runGit(checkout, 'commit', '-am', 'advance main');
  runGit(checkout, 'remote', 'add', 'origin', origin);
  runGit(checkout, 'push', '--set-upstream', 'origin', 'main');
  runGit(checkout, 'branch', 'prototype', baseSha);
  runGit(checkout, 'checkout', 'prototype');
  writeFileSync(join(checkout, 'prototype.txt'), 'not merged\n');
  runGit(checkout, 'add', 'prototype.txt');
  runGit(checkout, 'commit', '-m', 'unmerged prototype');
  const prototypeSha = runGit(checkout, 'rev-parse', 'HEAD').trim();

  const fakeBin = join(root, 'fake-bin');
  mkdirSync(fakeBin);
  const gitCalls = join(root, 'git-calls.log');
  const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeExecutable(join(fakeBin, 'git'), `#!/bin/bash
printf '%s\\n' "$*" >> "$TASKS_GIT_CALL_LOG"
exec "${realGit}" "$@"
`);
  const runWorkflowStep = (eventName: string, sha: string) => spawnSync(
    '/bin/bash', ['-euo', 'pipefail', '-c', `if [[ "$GITHUB_EVENT_NAME" == push ]]; then\n${guardScript}\nfi`], {
      cwd: checkout,
      env: {
        ...process.env,
        PATH: [fakeBin, process.env.PATH ?? ''].join(delimiter),
        TASKS_GIT_CALL_LOG: gitCalls,
        GITHUB_EVENT_NAME: eventName,
        GITHUB_SHA: sha,
      },
      encoding: 'utf8',
    },
  );

  let result = runWorkflowStep('push', baseSha);
  assert.equal(result.status, 0, result.stderr);
  const afterAccepted = readFileSync(gitCalls, 'utf8');
  assert.match(afterAccepted, /fetch --no-tags origin main:refs\/remotes\/origin\/main/);
  assert.match(afterAccepted, new RegExp(`merge-base --is-ancestor ${baseSha} origin/main`));

  result = runWorkflowStep('push', prototypeSha);
  assert.notEqual(result.status, 0, 'an unmerged prototype commit must fail before credentials');
  assert.match(result.stderr, /must already be contained in origin\/main/);
  const beforeManual = readFileSync(gitCalls, 'utf8');
  result = runWorkflowStep('workflow_dispatch', prototypeSha);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readFileSync(gitCalls, 'utf8'), beforeManual, 'manual verification must not fetch or inspect release ancestry');
});

test('Tasks build and release scripts exclude Needle and model runtime dependencies', () => {
  const buildScript = readFileSync(resolve(repositoryRoot, 'scripts/build-tasks.sh'), 'utf8');
  const packageScript = readFileSync(resolve(repositoryRoot, 'scripts/package-release.sh'), 'utf8');
  const workflow = readWorkflow('tasks-release.yml').source;
  for (const source of [buildScript, packageScript, workflow]) {
    assert.doesNotMatch(source, /Needle|Ollama|AI[-_ ]?model|model[-_ ]runtime/i);
  }
  for (const source of [buildScript, packageScript]) {
    assert.doesNotMatch(source, /\b(?:curl|wget)\b|git\s+(?:fetch|clone)\b/i);
  }
});

test('mocked packager preserves the Notes default and emits isolated product assets and checksums', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const fixture = createPackagerFixture();
  t.after(fixture.cleanup);

  let result = fixture.run();
  assert.equal(result.status, 0, result.stderr);
  const notesOutput = join(fixture.root, 'build', 'release');
  assert.deepEqual(readdirSync(notesOutput).sort(), [
    'Banana-Notes-1.2.3.dmg',
    'Banana-Notes-1.2.3.zip',
    'SHA256SUMS',
  ]);
  const notesChecksums = readFileSync(join(notesOutput, 'SHA256SUMS'), 'utf8');
  assert.match(notesChecksums, /Banana-Notes-1\.2\.3\.dmg$/m);
  assert.match(notesChecksums, /Banana-Notes-1\.2\.3\.zip$/m);
  assert.doesNotMatch(notesChecksums, /Banana-Viewer/);
  assert.equal(fixture.networkSubmissions().length, 2);

  fixture.clearNetworkLog();
  result = fixture.run({ args: ['viewer'] });
  assert.equal(result.status, 0, result.stderr);
  const viewerOutput = join(fixture.root, 'build', 'viewer-release');
  assert.deepEqual(readdirSync(viewerOutput).sort(), [
    'Banana-Viewer-0.1.1.dmg',
    'Banana-Viewer-0.1.1.zip',
    'SHA256SUMS',
  ]);
  const viewerChecksums = readFileSync(join(viewerOutput, 'SHA256SUMS'), 'utf8');
  assert.match(viewerChecksums, /Banana-Viewer-0\.1\.1\.dmg$/m);
  assert.match(viewerChecksums, /Banana-Viewer-0\.1\.1\.zip$/m);
  assert.doesNotMatch(viewerChecksums, /Banana-Notes/);
  assert.equal(fixture.networkSubmissions().length, 2);

  fixture.clearNetworkLog();
  result = fixture.run({ args: ['tasks'] });
  assert.equal(result.status, 0, result.stderr);
  const tasksOutput = join(fixture.root, 'build', 'tasks-release');
  assert.deepEqual(readdirSync(tasksOutput).sort(), [
    'Banana-Tasks-0.3.0.dmg',
    'Banana-Tasks-0.3.0.zip',
    'SHA256SUMS',
  ]);
  const tasksChecksums = readFileSync(join(tasksOutput, 'SHA256SUMS'), 'utf8');
  assert.match(tasksChecksums, /Banana-Tasks-0\.3\.0\.dmg$/m);
  assert.match(tasksChecksums, /Banana-Tasks-0\.3\.0\.zip$/m);
  assert.doesNotMatch(tasksChecksums, /Banana-(?:Notes|Viewer)/);
  assert.equal(fixture.networkSubmissions().length, 2);
});

test('mocked packager rejects unsafe metadata, signatures, and notarization credentials before submission', {
  skip: process.platform !== 'darwin',
}, (t) => {
  const cases: Array<{
    name: string;
    fixture?: FixtureOptions;
    run?: PackagerOverrides;
    expected: RegExp;
  }> = [
    {
      name: 'wrong bundle identity',
      fixture: { notesBundleId: 'com.example.wrong' },
      expected: /bundle identity does not match/,
    },
    {
      name: 'wrong Tasks bundle identity',
      fixture: { tasksBundleId: 'com.example.wrong' },
      run: { args: ['tasks'] },
      expected: /bundle identity does not match/,
    },
    {
      name: 'Tasks version differs from its owned release version',
      run: { args: ['tasks'], env: { TASKS_VERSION: '9.9.9' } },
      expected: /does not match the requested release version/,
    },
    {
      name: 'ad-hoc Tasks app cannot be packaged as a release',
      run: { args: ['tasks'], unset: ['SIGN_IDENTITY'] },
      expected: /SIGN_IDENTITY is required/,
    },
    {
      name: 'expected version mismatch',
      run: { args: ['viewer'], env: { VIEWER_VERSION: '9.9.9' } },
      expected: /does not match the requested release version/,
    },
    {
      name: 'Tasks signing team mismatch',
      run: { args: ['tasks'], env: { APPLE_TEAM_ID: 'TEAMID0002' } },
      expected: /not the expected APPLE_TEAM_ID/,
    },
    {
      name: 'wrong signing team',
      run: { args: ['viewer'], env: { APPLE_TEAM_ID: 'TEAMID0002' } },
      expected: /not the expected APPLE_TEAM_ID/,
    },
    {
      name: 'missing hardened runtime',
      run: { args: ['viewer'], env: { FAKE_HARDENED_RUNTIME: '0' } },
      expected: /hardened-runtime Developer ID signature/,
    },
    {
      name: 'incomplete notarization tuple',
      run: { unset: ['NOTARY_ISSUER'] },
      expected: /Notarization API credentials are incomplete/,
    },
  ];

  for (const scenario of cases) {
    const fixture = createPackagerFixture(scenario.fixture);
    t.after(fixture.cleanup);
    const result = fixture.run(scenario.run);
    assert.notEqual(result.status, 0, `${scenario.name} unexpectedly succeeded`);
    assert.match(`${result.stderr}`, scenario.expected, scenario.name);
    assert.deepEqual(fixture.networkSubmissions(), [], `${scenario.name} reached mocked notarization`);
  }
});

test('Viewer distribution signing uses hardened runtime while local builds stay ad-hoc', () => {
  const buildScript = readFileSync(resolve(repositoryRoot, 'scripts/build-viewer.sh'), 'utf8');
  assert.match(buildScript, /codesign --force --sign "\$VIEWER_SIGN_IDENTITY" --options runtime --timestamp "\$APP"/);
  assert.match(buildScript, /codesign --force --deep --sign - "\$APP"/);
});

test('Tasks release build stays universal, unsandboxed, and ad-hoc outside release signing', () => {
  const buildScript = readFileSync(resolve(repositoryRoot, 'scripts/build-tasks.sh'), 'utf8');
  const entitlements = readFileSync(resolve(repositoryRoot, 'packaging/BananaTasks.entitlements'), 'utf8');
  assert.match(buildScript, /-target "\$ARCH-apple-macosx14\.0"/);
  assert.match(buildScript, /lipo "\$MACOS\/Banana Tasks" -verify_arch arm64/);
  assert.match(buildScript, /lipo "\$MACOS\/Banana Tasks" -verify_arch x86_64/);
  assert.match(buildScript, /TASKS_SIGN_IDENTITY/);
  assert.match(buildScript, /codesign --force --sign "\$TASKS_SIGN_IDENTITY" --options runtime --timestamp/);
  assert.match(buildScript, /--entitlements "\$ENTITLEMENTS" "\$APP"/);
  assert.match(buildScript, /codesign --force --deep --sign - "\$APP"/);
  assert.match(entitlements, /<key>com\.apple\.security\.personal-information\.calendars<\/key>\s*<true\s*\/>/);
  assert.doesNotMatch(entitlements, /com\.apple\.security\.(?:app-sandbox|cs\.|device\.|automation\.|network\.)|debug-exception/);
});
