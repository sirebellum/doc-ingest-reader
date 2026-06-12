import Module from 'module';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

// 1. Intercept require to mock react-native Platform module in Node.js
const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'react-native') {
    return {
      Platform: {
        OS: 'web',
        select: (obj: any) => obj.web || obj.default,
      },
    };
  }
  if (id === 'expo-sqlite') {
    return {
      openDatabaseSync: () => ({
        execSync: () => {},
      }),
    };
  }
  return originalRequire.apply(this, arguments as any);
};

// 2. Import schema, worker, and types
import Database from 'better-sqlite3';
import { INITIALIZE_DATABASE_SCHEMA } from './schema';
import { processDocumentJob } from './worker';
import { ConnectorConfig, LlmRoute, CloudProvider } from '../api/connector';

// Helper to compute SHA-256 hash of a file
function computeSha256(filePath: string): string {
  const fileBuffer = fs.readFileSync(filePath);
  const hashSum = crypto.createHash('sha256');
  hashSum.update(fileBuffer);
  return hashSum.digest('hex');
}

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {
    file: '',
    route: 'local',
    endpoint: '',
    provider: '',
    model: '',
    all: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--file' || arg === '-f') {
      options.file = args[++i];
    } else if (arg === '--route' || arg === '-r') {
      options.route = args[++i];
    } else if (arg === '--endpoint' || arg === '-e') {
      options.endpoint = args[++i];
    } else if (arg === '--provider' || arg === '-p') {
      options.provider = args[++i];
    } else if (arg === '--model' || arg === '-m') {
      options.model = args[++i];
    } else if (arg === '--all' || arg === '-a') {
      options.all = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  return options;
}

function printHelp() {
  console.log(`
🚀 LLM PDF Ingestion CLI Test Runner
=====================================
Ingest PDF, Markdown, HTML, or EPUB documents locally on your desktop into the Web UI database.

Usage:
  npx ts-node src/database/runIngestCLI.ts [options]

Options:
  -f, --file <name>       Name of the file in test_artifacts/test_inputs/ (or path to any file) to ingest.
  -o, --output <name>     Name of the output SQLite file (default: llm_pdf_reader.db).
  -a, --all               Ingest all files declared in test_artifacts/test_inputs/manifest.json.
  -r, --route <route>     LLM route to use: local, network, cloud. (Default: local)
  -e, --endpoint <url>    Local network endpoint (e.g. http://localhost:11434 for Ollama)
  -p, --provider <name>   Cloud provider if using cloud: gemini, claude, openai
  -m, --model <name>      Model identifier to request from target LLM.
  -h, --help              Show this help message.

Examples:
  # Ingest default file (Research Notes.pdf) using mock/local inference
  npx ts-node src/database/runIngestCLI.ts

  # Ingest scholarly paper using local Ollama model
  npx ts-node src/database/runIngestCLI.ts -f "Prevost_2018_Distributed_Edge_Cloud.pdf" -r network -e http://localhost:11434 -m llama3
  `);
}

async function run() {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    return;
  }

  // Paths mapping
  const assetsDir = path.resolve(__dirname, '../../assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const assetsDbPath = path.join(assetsDir, 'llm_pdf_reader.db');
  const testInputsDir = path.resolve(__dirname, '../../../test_artifacts/test_inputs');
  const manifestPath = path.join(testInputsDir, 'manifest.json');

  console.log(`\n📂 Active Database Path: ${assetsDbPath}`);
  console.log(`📁 Test Inputs Directory: ${testInputsDir}`);

  // 1. Initialize SQLite Database via better-sqlite3
  const db = new Database(assetsDbPath);
  db.exec(INITIALIZE_DATABASE_SCHEMA);

  // 2. Seed default collection if missing
  db.prepare(`
    INSERT OR IGNORE INTO corpora (id, name, description)
    VALUES ('corpus-test', 'Local Ingests', 'Collection of documents ingested locally via desktop CLI test runner.');
  `).run();

  // 3. Load manifest file
  if (!fs.existsSync(manifestPath)) {
    console.error(`❌ Manifest file not found at ${manifestPath}. Please run from root directory.`);
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const availableFiles: any[] = manifest.files || [];

  // Determine which files to process
  let filesToProcess: any[] = [];

  if (options.all) {
    filesToProcess = availableFiles;
  } else if (options.file) {
    const requestedFile = options.file as string;
    // Check if filename matches manifest or absolute path
    const matched = availableFiles.find(f => f.filename === requestedFile || path.basename(requestedFile) === f.filename);
    if (matched) {
      filesToProcess = [matched];
    } else {
      // Direct path
      const filePath = path.isAbsolute(requestedFile) ? requestedFile : path.resolve(process.cwd(), requestedFile);
      if (!fs.existsSync(filePath)) {
        console.error(`❌ File not found at path: ${filePath}`);
        process.exit(1);
      }
      const ext = path.extname(filePath).substring(1).toLowerCase();
      filesToProcess = [{
        filename: path.basename(filePath),
        title: path.basename(filePath, path.extname(filePath)),
        author: 'Unknown Author',
        description: 'Directly ingested document file.',
        source_type: ext,
        _absolutePath: filePath
      }];
    }
  } else {
    // Default to the fast PDF notes
    const defaultMatched = availableFiles.find(f => f.filename === 'Research Notes.pdf');
    if (defaultMatched) {
      console.log(`📝 No file specified. Defaulting to 'Research Notes.pdf'...`);
      filesToProcess = [defaultMatched];
    } else if (availableFiles.length > 0) {
      console.log(`📝 No file specified. Defaulting to first available in manifest: '${availableFiles[0].filename}'`);
      filesToProcess = [availableFiles[0]];
    } else {
      console.error(`❌ No test files available in manifest.`);
      process.exit(1);
    }
  }

  // Set up LLM configuration
  const config: ConnectorConfig = {
    route: options.route as LlmRoute,
    endpoint: options.endpoint as string || undefined,
    provider: options.provider as CloudProvider || undefined,
    modelName: options.model as string || undefined
  };

  console.log(`⚙️  LLM Route Configured: [${config.route.toUpperCase()}]` + 
              (config.endpoint ? ` Endpoint: ${config.endpoint}` : '') +
              (config.provider ? ` Provider: ${config.provider}` : '') +
              (config.modelName ? ` Model: ${config.modelName}` : '') + '\n');

  // Process files
  for (const fileRecord of filesToProcess) {
    const rawFilename = fileRecord.filename;
    const resolvedPath = fileRecord._absolutePath || path.join(testInputsDir, rawFilename);

    if (!fs.existsSync(resolvedPath)) {
      console.error(`❌ Input file does not exist: ${resolvedPath}`);
      continue;
    }

    console.log(`⏳ Starting Ingestion of: "${fileRecord.title}" (${rawFilename})`);
    console.log(`   Location: ${resolvedPath}`);

    const sha256 = computeSha256(resolvedPath);
    const docId = `doc-${sha256.substring(0, 16)}`;
    const ext = path.extname(resolvedPath).substring(1).toLowerCase();
    const docSourceType = fileRecord.source_type || ext;

    // Seed document metadata row into documents table (required by background worker)
    db.prepare(`
      INSERT OR REPLACE INTO documents (id, corpus_id, title, author, source_type, sha256_hash, storage_path, metadata)
      VALUES (?, 'corpus-test', ?, ?, ?, ?, ?, ?);
    `).run(
      docId,
      fileRecord.title,
      fileRecord.author || 'Unknown',
      docSourceType,
      sha256,
      resolvedPath,
      JSON.stringify({ description: fileRecord.description, size: fs.statSync(resolvedPath).size })
    );

    try {
      const startTime = Date.now();
      const jobId = await processDocumentJob({
        db,
        documentId: docId,
        filePath: resolvedPath,
        config
      });
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`✅ Completed ingestion for Job: ${jobId} in ${elapsed}s!`);
    } catch (e) {
      console.error(`❌ Ingestion failed for "${fileRecord.title}":`, e);
    }
  }

  // 4. Generate SQLite report of final state
  console.log(`\n📊 Database Verification & Stats Report`);
  console.log(`========================================`);

  const documents = db.prepare('SELECT COUNT(*) as count FROM documents;').get() as any;
  const sections = db.prepare('SELECT COUNT(*) as count FROM sections;').get() as any;
  const blocks = db.prepare('SELECT COUNT(*) as count FROM blocks;').get() as any;
  const tags = db.prepare('SELECT COUNT(*) as count FROM tags;').get() as any;
  const blockTags = db.prepare('SELECT COUNT(*) as count FROM block_tags;').get() as any;
  const annotations = db.prepare('SELECT COUNT(*) as count FROM annotations;').get() as any;
  const vectorCache = db.prepare('SELECT COUNT(*) as count FROM vector_cache;').get() as any;

  console.log(`  📚 Total Ingested Documents:  ${documents.count}`);
  console.log(`  📑 Total TOC Chapter Sections: ${sections.count}`);
  console.log(`  🧱 Total XHTML Content Blocks: ${blocks.count}`);
  console.log(`  🏷️  Total Semantic Tags:       ${tags.count}`);
  console.log(`  🔗 Total Block-Tag Mappings:  ${blockTags.count}`);
  console.log(`  🖍️  Total Auto Highlights Logged: ${annotations.count}`);
  console.log(`  🧬 Total Cached Vector Embeddings: ${vectorCache.count}`);

  const blockTypes: any[] = db.prepare('SELECT block_type, COUNT(*) as cnt FROM blocks GROUP BY block_type;').all();
  if (blockTypes.length > 0) {
    console.log(`\n🧱 Blocks breakdown by type:`);
    blockTypes.forEach(b => {
      console.log(`    - ${b.block_type.padEnd(12)}: ${b.cnt}`);
    });
  }

  console.log(`\n🌟 Database successfully exported and mapped to Expo assets folder!`);
  console.log(`👉 You can now run 'npm run web' or start tests. The Web UI will automatically access this real parsed data.`);
  db.close();

  // Copy to public/assets and web/assets so that the dev server can serve it directly
  const copyPaths = [
    path.join(__dirname, '../../public/assets/llm_pdf_reader.db'),
    path.join(__dirname, '../../web/assets/llm_pdf_reader.db'),
  ];
  for (const cp of copyPaths) {
    try {
      fs.mkdirSync(path.dirname(cp), { recursive: true });
      fs.copyFileSync(assetsDbPath, cp);
      console.log(`📋 Copied database to: ${cp}`);
    } catch (e) {
      console.warn(`⚠️  Failed to copy database to ${cp}:`, (e as Error).message);
    }
  }
}

run().catch(err => {
  console.error('❌ Critical runtime error in CLI Ingestion Test Runner:', err);
  process.exit(1);
});
