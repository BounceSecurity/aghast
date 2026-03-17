const fs = require('fs');

const version = process.argv[2];
if (!version) {
  console.error('Usage: node update-version-refs.cjs <version>');
  process.exit(1);
}

// Update package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
pkg.version = version;
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

// Update version references in docs
for (const file of ['docs/getting-started.md']) {
  let content = fs.readFileSync(file, 'utf-8');
  content = content.replace(
    /@bouncesecurity\/aghast@[0-9]+\.[0-9]+\.[0-9]+/g,
    '@bouncesecurity/aghast@' + version
  );
  fs.writeFileSync(file, content);
}

// Update release workflow description with next possible versions
const [major, minor, patch] = version.split('.').map(Number);
const nextPatch = `${major}.${minor}.${patch + 1}`;
const nextMinor = `${major}.${minor + 1}.0`;
const nextMajor = `${major + 1}.0.0`;
const releaseYml = fs.readFileSync('.github/workflows/release.yml', 'utf-8');
const updatedYml = releaseYml.replace(
  /description: 'Release version \(e\.g\. [^']+\)'/,
  `description: 'Release version (e.g. ${nextPatch}, ${nextMinor}, ${nextMajor})'`
);
fs.writeFileSync('.github/workflows/release.yml', updatedYml);
