const fs = require('fs');
const path = require('path');

// 1. Read and parse README.md
const readmePath = path.join(__dirname, '../README.md');
if (!fs.existsSync(readmePath)) {
  console.error('Error: README.md not found at ' + readmePath);
  process.exit(1);
}

const readmeContent = fs.readFileSync(readmePath, 'utf8');

// List of expected CMake commands in README.md
const expectedCommands = [
  'cmake -B build',
  'cmake --build build',
  'cmake --build build --target start-desktop-server',
  'cmake --build build --target start-web-server',
  'ctest'
];

for (const cmd of expectedCommands) {
  if (!readmeContent.includes(cmd)) {
    console.error(`Error: README.md does not contain the expected command: "${cmd}"`);
    process.exit(1);
  }
}
console.log('README.md command checks passed.');

// 2. Check generated artifacts
const testArtifactsDir = path.join(__dirname, '../rust_core/parser/target/test_artifacts');

const expectedFiles = [
  'test_corpus.db',
  'synthetic_pre_pdf.json',
  'golden_test.pdf',
  'synthetic_pass1_output.json',
  'synthetic_pass2_output.json',
  'synthetic_test.db'
];

for (const file of expectedFiles) {
  const filePath = path.join(testArtifactsDir, file);
  if (!fs.existsSync(filePath)) {
    console.error(`Error: Expected artifact file not found: ${filePath}`);
    console.error('Ensure that you ran Cargo tests before executing this validation.');
    process.exit(1);
  }
  const stats = fs.statSync(filePath);
  if (stats.size === 0) {
    console.error(`Error: Artifact file is empty: ${filePath}`);
    process.exit(1);
  }
  console.log(`Artifact file verified: ${file} (${stats.size} bytes)`);
}

// 3. Verify SQLite DB Header
const dbFiles = ['test_corpus.db', 'synthetic_test.db'];
for (const dbFile of dbFiles) {
  const dbPath = path.join(testArtifactsDir, dbFile);
  const buffer = Buffer.alloc(16);
  const fd = fs.openSync(dbPath, 'r');
  fs.readSync(fd, buffer, 0, 16, 0);
  fs.closeSync(fd);
  
  const header = buffer.toString('utf8', 0, 15);
  if (header !== 'SQLite format 3') {
    console.error(`Error: File is not a valid SQLite 3 database: ${dbPath} (Header: "${header}")`);
    process.exit(1);
  }
  console.log(`SQLite database structure validated: ${dbFile}`);
}

console.log('ALL README.md TEST CONFIGURATIONS AND ARTIFACTS VALIDATED SUCCESSFULLY!');
process.exit(0);
