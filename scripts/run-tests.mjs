import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const testRoot = path.resolve("dist", "test");

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectTestFiles(entryPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".test.js")) {
      files.push(entryPath);
    }
  }

  return files;
}

let testFiles = [];
try {
  testFiles = await collectTestFiles(testRoot);
} catch (error) {
  const code =
    error && typeof error === "object" && "code" in error ? error.code : undefined;
  const message = error instanceof Error ? error.message : String(error);

  if (code === "ENOENT") {
    console.error("No compiled test files found in dist/test.");
  } else {
    console.error(`Failed to discover compiled test files: ${message}`);
  }

  process.exit(1);
}

if (testFiles.length === 0) {
  console.error("No compiled test files found in dist/test.");
  process.exit(1);
}

const child = spawn(
  process.execPath,
  ["--test", ...testFiles.map((filePath) => path.relative(process.cwd(), filePath))],
  { stdio: "inherit" },
);

child.on("error", (error) => {
  console.error(`Failed to start test runner: ${error.message}`);
  process.exit(1);
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`Test runner terminated by signal ${signal}.`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
