import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { access, mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import yauzl, { type Entry, type ZipFile } from "yauzl";

const MAX_ARCHIVE_ENTRIES = 10;
const MAX_COMPRESSION_RATIO = 100;
const SOURCE2_DEMO_SIGNATURE = "PBDEMS2";

export interface DemoFileInfo {
  demoPath: string;
  byteSize: number;
  sha256: string;
  signature: string;
  format: "source2-demo" | "unknown";
}

export interface ImportedDemo {
  archiveType: "zip" | "dem";
  archivePath: string;
  demo: DemoFileInfo;
}

interface ArchiveEntrySummary {
  fileName: string;
  uncompressedSize: number;
}

function isDirectory(entry: Entry): boolean {
  return entry.fileName.endsWith("/");
}

function assertSafeArchivePath(fileName: string): void {
  const normalized = path.posix.normalize(fileName);
  if (
    fileName.length === 0 ||
    fileName.includes("\\") ||
    fileName.includes("\0") ||
    fileName.startsWith("/") ||
    normalized === "." ||
    normalized.startsWith("../") ||
    normalized !== fileName
  ) {
    throw new Error(`Unsafe archive entry path: ${fileName}`);
  }
}

function openZip(archivePath: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(archivePath, { autoClose: true, lazyEntries: true, decodeStrings: true }, (error, zipFile) => {
      if (error !== null || zipFile === undefined) {
        reject(error ?? new Error("Could not open ZIP archive."));
        return;
      }
      resolve(zipFile);
    });
  });
}

async function inspectZip(archivePath: string, maxDemoSizeBytes: number): Promise<ArchiveEntrySummary> {
  const zipFile = await openZip(archivePath);

  return new Promise<ArchiveEntrySummary>((resolve, reject) => {
    let entryCount = 0;
    let demoEntry: ArchiveEntrySummary | undefined;
    let settled = false;

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    }

    zipFile.on("error", (error) => fail(error));
    zipFile.on("entry", (entry: Entry) => {
      try {
        entryCount += 1;
        if (entryCount > MAX_ARCHIVE_ENTRIES) {
          fail(new Error(`ZIP contains more than ${MAX_ARCHIVE_ENTRIES} entries.`));
          return;
        }

        assertSafeArchivePath(entry.fileName);
        if (!isDirectory(entry)) {
          const extension = path.posix.extname(entry.fileName).toLowerCase();
          if (extension !== ".dem") {
            fail(new Error("ZIP may only contain one .dem file."));
            return;
          }
          if (demoEntry !== undefined) {
            fail(new Error("ZIP must contain exactly one .dem file."));
            return;
          }
          if (entry.uncompressedSize === 0 || entry.uncompressedSize > maxDemoSizeBytes) {
            fail(new Error("Demo size declared by ZIP is outside the allowed limit."));
            return;
          }
          if (entry.compressedSize === 0 || entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO) {
            fail(new Error("ZIP compression ratio exceeds the allowed limit."));
            return;
          }
          demoEntry = { fileName: entry.fileName, uncompressedSize: entry.uncompressedSize };
        }
        zipFile.readEntry();
      } catch (error) {
        fail(error instanceof Error ? error : new Error("Unable to inspect ZIP archive."));
      }
    });
    zipFile.on("end", () => {
      if (settled) return;
      settled = true;
      if (demoEntry === undefined) {
        reject(new Error("ZIP does not contain a .dem file."));
        return;
      }
      resolve(demoEntry);
    });

    zipFile.readEntry();
  });
}

async function extractZipEntry(archivePath: string, entryName: string, destinationPath: string, maxBytes: number): Promise<void> {
  const zipFile = await openZip(archivePath);

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    function fail(error: Error) {
      if (settled) return;
      settled = true;
      zipFile.close();
      reject(error);
    }

    zipFile.on("error", (error) => fail(error));
    zipFile.on("entry", (entry: Entry) => {
      if (entry.fileName !== entryName) {
        zipFile.readEntry();
        return;
      }

      zipFile.openReadStream(entry, async (error, readStream) => {
        if (error !== null || readStream === undefined) {
          fail(error ?? new Error("Could not read demo entry from ZIP."));
          return;
        }

        let extractedBytes = 0;
        readStream.on("data", (chunk: Buffer) => {
          extractedBytes += chunk.length;
          if (extractedBytes > maxBytes) {
            readStream.destroy(new Error("Extracted demo exceeds the allowed size."));
          }
        });

        try {
          await pipeline(readStream, createWriteStream(destinationPath, { flags: "wx" }));
          settled = true;
          zipFile.close();
          resolve();
        } catch (streamError) {
          fail(streamError instanceof Error ? streamError : new Error("Could not extract demo."));
        }
      });
    });
    zipFile.on("end", () => fail(new Error("Expected demo entry was not found in ZIP.")));
    zipFile.readEntry();
  });
}

async function inspectDemoFile(demoPath: string): Promise<DemoFileInfo> {
  const fileStat = await stat(demoPath);
  const fileHandle = await open(demoPath, "r");
  const header = Buffer.alloc(SOURCE2_DEMO_SIGNATURE.length);

  try {
    await fileHandle.read(header, 0, header.length, 0);
  } finally {
    await fileHandle.close();
  }

  const hash = createHash("sha256");
  await pipeline(createReadStream(demoPath), hash);
  const signature = header.toString("ascii");

  return {
    demoPath,
    byteSize: fileStat.size,
    sha256: hash.digest("hex"),
    signature,
    format: signature === SOURCE2_DEMO_SIGNATURE ? "source2-demo" : "unknown",
  };
}

export async function importDemo(
  sourcePath: string,
  workDirectory: string,
  maxDemoSizeBytes: number,
): Promise<ImportedDemo> {
  await access(sourcePath);
  const sourceExtension = path.extname(sourcePath).toLowerCase();
  const sourceStat = await stat(sourcePath);

  if (sourceStat.size === 0 || sourceStat.size > maxDemoSizeBytes) {
    throw new Error("Source demo file size is outside the allowed limit.");
  }

  if (sourceExtension === ".dem") {
    return {
      archiveType: "dem",
      archivePath: sourcePath,
      demo: await inspectDemoFile(sourcePath),
    };
  }

  if (sourceExtension !== ".zip") {
    throw new Error("Only .zip and .dem sources are supported.");
  }

  const demoEntry = await inspectZip(sourcePath, maxDemoSizeBytes);
  await mkdir(workDirectory, { recursive: true });

  const temporaryPath = path.join(workDirectory, `${randomUUID()}.partial`);
  const demoPath = path.join(workDirectory, `${randomUUID()}.dem`);
  try {
    await extractZipEntry(sourcePath, demoEntry.fileName, temporaryPath, maxDemoSizeBytes);
    await rename(temporaryPath, demoPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return {
    archiveType: "zip",
    archivePath: sourcePath,
    demo: await inspectDemoFile(demoPath),
  };
}
