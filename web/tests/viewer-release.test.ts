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
};

type FixtureOptions = { notesBundleId?: string; viewerBundleId?: string };
type PackagerOverrides = { args?: string[]; env?: Record<string, string>; unset?: string[] };

function writeExecutable(path: string, content: string): void {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function addPlistString(plistPath: string, key: string, value: string): void {
  execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string "${value}"`, plistPath]);
}

function createApp(root: string, product: 'notes' | 'viewer', bundleId: string, version: string): void {
  const name = product === 'notes' ? 'Banana Notes' : 'Banana Viewer';
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
      const product = args[0] === 'viewer' ? 'viewer' : 'notes';
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

test('Notes and Viewer release tag filters are disjoint', () => {
  const notes = readWorkflow('release.yml').workflow;
  const viewer = readWorkflow('viewer-release.yml').workflow;
  const notesTags = notes.on?.push?.tags ?? [];
  const viewerTags = viewer.on?.push?.tags ?? [];

  assert.deepEqual(notesTags, ['v[0-9]*']);
  assert.deepEqual(viewerTags, ['viewer-v[0-9]*']);
  assert.ok(notes.on?.workflow_dispatch !== undefined);
  assert.ok(viewer.on?.workflow_dispatch !== undefined);
  assert.equal(notesTags.some(pattern => githubTagMatches(pattern, 'viewer-v0.1.1')), false);
  assert.equal(viewerTags.some(pattern => githubTagMatches(pattern, 'v0.2.7')), false);
  assert.equal(notesTags.some(pattern => githubTagMatches(pattern, 'v0.2.7')), true);
  assert.equal(viewerTags.some(pattern => githubTagMatches(pattern, 'viewer-v0.1.1')), true);
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
      name: 'expected version mismatch',
      run: { args: ['viewer'], env: { VIEWER_VERSION: '9.9.9' } },
      expected: /does not match the requested release version/,
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
