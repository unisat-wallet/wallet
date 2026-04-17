const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const extensionDir = path.resolve(__dirname, '..');
const packageJsonPath = path.join(extensionDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const packageVersion = packageJson.version;
const manifestVersion = packageVersion.split('-beta')[0];

function fail(message) {
  console.error(message);
  process.exit(1);
}

function readArg(name) {
  const exact = `${name}=`;
  for (let i = 0; i < process.argv.length; i += 1) {
    const value = process.argv[i];
    if (value === name) {
      return process.argv[i + 1];
    }
    if (value.startsWith(exact)) {
      return value.slice(exact.length);
    }
  }
  return '';
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: extensionDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  });
}

function getGitStatus(args) {
  return run('git', args).trim();
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate())
  ].join('-') + ` ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

const artifactVersion = readArg('--artifact-version');

if (!artifactVersion) {
  fail(`missing --artifact-version. expected ${manifestVersion} or ${manifestVersion}-beta.N`);
}

if (artifactVersion !== manifestVersion && !artifactVersion.startsWith(`${manifestVersion}-`)) {
  fail(
    `invalid --artifact-version=${artifactVersion}. expected ${manifestVersion} or a value starting with ${manifestVersion}-`
  );
}

const trackedStatusBefore = getGitStatus(['status', '--short', '--untracked-files=no']);

execFileSync('pnpm', ['build:chrome:mv3', `--artifact-version=${artifactVersion}`], {
  cwd: extensionDir,
  stdio: 'inherit'
});

const artifactName = `unisat-chrome-mv3-v${artifactVersion}.zip`;
const artifactPath = path.join(extensionDir, 'dist', artifactName);

if (!fs.existsSync(artifactPath)) {
  fail(`build finished but artifact was not found: ${artifactPath}`);
}

const manifestRaw = run('unzip', ['-p', artifactPath, 'manifest.json']);
const manifest = JSON.parse(manifestRaw);

if (manifest.version !== manifestVersion) {
  fail(`manifest version mismatch. expected ${manifestVersion}, got ${manifest.version}`);
}

const sha256 = crypto.createHash('sha256').update(fs.readFileSync(artifactPath)).digest('hex');
const artifactStat = fs.statSync(artifactPath);
const trackedStatusAfter = getGitStatus(['status', '--short', '--untracked-files=no']);
const fullStatusAfter = getGitStatus(['status', '--short']);
const untrackedAfter = fullStatusAfter
  ? fullStatusAfter
      .split('\n')
      .filter((line) => line.startsWith('?? '))
      .map((line) => line.slice(3))
  : [];

console.log('');
console.log('Artifact:', artifactPath);
console.log('Manifest version:', manifest.version);
console.log('File time:', formatTimestamp(artifactStat.mtime));
console.log('File size:', formatBytes(artifactStat.size));
console.log('SHA-256:', sha256);
if (trackedStatusBefore === trackedStatusAfter) {
  console.log('Tracked changes from packaging: none');
} else {
  console.log('Tracked changes from packaging: detected');
  console.log(trackedStatusAfter || '(empty)');
}
if (untrackedAfter.length > 0) {
  console.log('Current untracked entries:', untrackedAfter.join(', '));
}
