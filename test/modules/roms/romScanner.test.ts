import os from 'node:os';
import path from 'node:path';

import Temp from '../../../src/globals/temp.js';
import ROMScanner from '../../../src/modules/roms/romScanner.js';
import ArrayPoly from '../../../src/polyfill/arrayPoly.js';
import fsPoly from '../../../src/polyfill/fsPoly.js';
import ArchiveEntry from '../../../src/types/files/archives/archiveEntry.js';
import FileCache from '../../../src/types/files/fileCache.js';
import { ChecksumBitmask } from '../../../src/types/files/fileChecksums.js';
import FileFactory from '../../../src/types/files/fileFactory.js';
import Options, { OptionsProps } from '../../../src/types/options.js';
import ProgressBarFake from '../../console/progressBarFake.js';

function createRomScanner(input: string[], inputExclude: string[] = []): ROMScanner {
  return new ROMScanner(
    new Options({ input, inputExclude }),
    new ProgressBarFake(),
    new FileFactory(new FileCache()),
  );
}

it('should throw on nonexistent paths', async () => {
  await expect(createRomScanner(['/completely/invalid/path']).scan()).rejects.toThrow(
    /no files found/i,
  );
  await expect(createRomScanner(['/completely/invalid/path', os.devNull]).scan()).rejects.toThrow(
    /no files found/i,
  );
  await expect(createRomScanner(['test/fixtures/**/*.tmp']).scan()).rejects.toThrow(
    /no files found/i,
  );
  await expect(createRomScanner(['test/fixtures/roms/*foo*/*bar*']).scan()).rejects.toThrow(
    /no files found/i,
  );
});

it('should throw on no results', async () => {
  await expect(createRomScanner([]).scan()).rejects.toThrow(/no files found/i);
  await expect(createRomScanner(['']).scan()).rejects.toThrow(/no files found/i);
  await expect(createRomScanner([os.devNull]).scan()).rejects.toThrow(/no files found/i);
});

it('should not throw on bad archives', async () => {
  await expect(
    createRomScanner(['test/fixtures/roms/**/invalid.zip']).scan(),
  ).resolves.toHaveLength(0);
  await expect(
    createRomScanner(['test/fixtures/roms/**/invalid.rar']).scan(),
  ).resolves.toHaveLength(0);
  await expect(createRomScanner(['test/fixtures/roms/**/invalid.7z']).scan()).resolves.toHaveLength(
    0,
  );
});

describe('multiple files', () => {
  it('should scan multiple files with no exclusions', async () => {
    const expectedRomFiles = 94;
    await expect(createRomScanner(['test/fixtures/roms']).scan()).resolves.toHaveLength(
      expectedRomFiles,
    );
    await expect(
      createRomScanner(['test/fixtures/roms/*', 'test/fixtures/roms/**/*']).scan(),
    ).resolves.toHaveLength(expectedRomFiles);
    await expect(createRomScanner(['test/fixtures/roms/**/*']).scan()).resolves.toHaveLength(
      expectedRomFiles,
    );
    await expect(
      createRomScanner(['test/fixtures/roms/**/*', 'test/fixtures/roms/**/*.{rom,zip}']).scan(),
    ).resolves.toHaveLength(expectedRomFiles);
  });

  test.each([
    [{ input: [path.join('test', 'fixtures', 'roms')] }, 137],
    [{ input: [path.join('test', 'fixtures', 'roms', '7z')] }, 12],
    [{ input: [path.join('test', 'fixtures', 'roms', 'gz')] }, 14],
    [{ input: [path.join('test', 'fixtures', 'roms', 'rar')] }, 12],
    [{ input: [path.join('test', 'fixtures', 'roms', 'tar')] }, 12],
    [{ input: [path.join('test', 'fixtures', 'roms', 'zip')] }, 15],
  ] satisfies [OptionsProps, number][])(
    'should calculate checksums of archives: %s',
    async (optionsProps, expectedRomFiles) => {
      const checksumBitmask = Object.keys(ChecksumBitmask)
        .filter((bitmask): bitmask is keyof typeof ChecksumBitmask => Number.isNaN(Number(bitmask)))
        .reduce((allBitmasks, bitmask) => allBitmasks | ChecksumBitmask[bitmask], 0);
      const scannedFiles = await new ROMScanner(
        new Options(optionsProps),
        new ProgressBarFake(),
        new FileFactory(new FileCache()),
      ).scan(checksumBitmask, true);
      expect(scannedFiles).toHaveLength(expectedRomFiles);
    },
  );

  it('should scan quickly', async () => {
    const options = new Options({
      input: [path.join('test', 'fixtures', 'roms')],
      inputChecksumQuick: true,
    });

    const scannedFiles = await new ROMScanner(
      options,
      new ProgressBarFake(),
      new FileFactory(new FileCache()),
    ).scan(ChecksumBitmask.CRC32, false);

    const extensionsWithoutCrc32 = scannedFiles
      .filter((file) => file instanceof ArchiveEntry)
      .filter((file) => !file.getCrc32())
      .map((file) => {
        const match = file.getFilePath().match(/[^.]+((\.[a-zA-Z0-9]+)+)$/);
        return match ? match[1] : undefined;
      })
      .filter((ext) => ext !== undefined)
      .reduce(ArrayPoly.reduceUnique(), [])
      .sort();
    expect(extensionsWithoutCrc32).toEqual(['.chd', '.tar.gz']);

    const entriesWithMd5 = scannedFiles
      .filter((file) => file instanceof ArchiveEntry)
      .filter((file) => file.getMd5());
    expect(entriesWithMd5).toHaveLength(0);

    const extensionsWithSha1 = scannedFiles
      .filter((file) => file instanceof ArchiveEntry)
      .filter((file) => file.getSha1())
      .map((file) => {
        const match = file.getFilePath().match(/[^.]+((\.[a-zA-Z0-9]+)+)$/);
        return match ? match[1] : undefined;
      })
      .filter((ext) => ext !== undefined)
      .reduce(ArrayPoly.reduceUnique(), [])
      .sort();
    expect(extensionsWithSha1).toEqual(['.chd']);

    const entriesWithSha256 = scannedFiles
      .filter((file) => file instanceof ArchiveEntry)
      .filter((file) => file.getSha256());
    expect(entriesWithSha256).toHaveLength(0);
  });

  it('should scan multiple files with some file exclusions', async () => {
    await expect(
      createRomScanner(['test/fixtures/roms/**/*'], ['test/fixtures/roms/**/*.rom']).scan(),
    ).resolves.toHaveLength(77);
    await expect(
      createRomScanner(
        ['test/fixtures/roms/**/*'],
        ['test/fixtures/roms/**/*.rom', 'test/fixtures/roms/**/*.rom'],
      ).scan(),
    ).resolves.toHaveLength(77);
    await expect(
      createRomScanner(
        ['test/fixtures/roms/**/*'],
        ['test/fixtures/roms/**/*.rom', 'test/fixtures/roms/**/*.zip'],
      ).scan(),
    ).resolves.toHaveLength(66);
  });

  it('should scan multiple files with every file excluded', async () => {
    await expect(
      createRomScanner(['test/fixtures/roms/**/*'], ['test/fixtures/roms/**/*']).scan(),
    ).resolves.toHaveLength(0);
    await expect(
      createRomScanner(
        ['test/fixtures/roms/**/*'],
        ['test/fixtures/roms/**/*', 'test/fixtures/roms/**/*'],
      ).scan(),
    ).resolves.toHaveLength(0);
    await expect(
      createRomScanner(
        ['test/fixtures/roms/**/*'],
        ['test/fixtures/roms/*', 'test/fixtures/roms/*/**/*'],
      ).scan(),
    ).resolves.toHaveLength(0);
    await expect(
      createRomScanner(
        ['test/fixtures/roms/**/*'],
        ['test/fixtures/roms/**/*.zip', 'test/fixtures/roms/**/*'],
      ).scan(),
    ).resolves.toHaveLength(0);
  });

  it('should scan hard links', async () => {
    const scannedRealFiles = (await createRomScanner(['test/fixtures/roms']).scan()).sort((a, b) =>
      a.getFilePath().localeCompare(b.getFilePath()),
    );

    // Given some hard linked files
    const tempDir = await fsPoly.mkdtemp(Temp.getTempDir());
    try {
      const filesDir = path.join(tempDir, 'files');
      await fsPoly.mkdir(filesDir);

      const romFiles = await Promise.all(
        (await fsPoly.walk('test/fixtures/roms')).map(async (romFile) => {
          // Make a copy of the original file to ensure it's on the same drive
          const tempFile = path.join(filesDir, romFile);
          await fsPoly.mkdir(path.dirname(tempFile), { recursive: true });
          await fsPoly.copyFile(romFile, tempFile);
          return tempFile;
        }),
      );

      const linksDir = path.join(tempDir, 'links');
      await fsPoly.mkdir(linksDir);

      await Promise.all(
        romFiles.map(async (romFile) => {
          const tempLink = path.join(linksDir, path.relative(filesDir, romFile));
          await fsPoly.mkdir(path.dirname(tempLink), { recursive: true });
          await fsPoly.hardlink(path.resolve(romFile), tempLink);
        }),
      );

      // When scanning symlinked files
      const scannedSymlinks = (await createRomScanner([linksDir]).scan()).sort((a, b) =>
        a.getFilePath().localeCompare(b.getFilePath()),
      );

      // Then the files scan successfully
      expect(scannedSymlinks).toHaveLength(scannedRealFiles.length);
      for (const [idx, scannedSymlink] of scannedSymlinks.entries()) {
        expect(scannedSymlink.getSize()).toEqual(scannedRealFiles[idx].getSize());
        expect(scannedSymlink.getCrc32()).toEqual(scannedRealFiles[idx].getCrc32());
      }
    } finally {
      await fsPoly.rm(tempDir, { recursive: true });
    }
  });

  it('should scan symlinks', async () => {
    const scannedRealFiles = (await createRomScanner(['test/fixtures/roms']).scan()).sort((a, b) =>
      a.getFilePath().localeCompare(b.getFilePath()),
    );

    // Given some symlinked files
    const tempDir = await fsPoly.mkdtemp(Temp.getTempDir());
    try {
      const romFiles = await fsPoly.walk('test/fixtures/roms');
      await Promise.all(
        romFiles.map(async (romFile, idx) => {
          const tempLink = path.join(tempDir, romFile);
          await fsPoly.mkdir(path.dirname(tempLink), { recursive: true });
          if (idx % 2 === 0) {
            // symlink some files with absolute paths
            await fsPoly.symlink(path.resolve(romFile), tempLink);
          } else {
            // symlink some files with relative paths
            await fsPoly.symlink(await fsPoly.symlinkRelativePath(romFile, tempLink), tempLink);
          }
        }),
      );

      // When scanning symlinked files
      const scannedSymlinks = (await createRomScanner([tempDir]).scan()).sort((a, b) =>
        a.getFilePath().localeCompare(b.getFilePath()),
      );

      // Then the files scan successfully
      expect(scannedSymlinks).toHaveLength(scannedRealFiles.length);
      for (const [idx, scannedSymlink] of scannedSymlinks.entries()) {
        expect(scannedSymlink.getSize()).toEqual(scannedRealFiles[idx].getSize());
        expect(scannedSymlink.getCrc32()).toEqual(scannedRealFiles[idx].getCrc32());
      }
    } finally {
      await fsPoly.rm(tempDir, { recursive: true });
    }
  });

  it('should scan symlinked directories', async () => {
    const realRomDir = path.join('test', 'fixtures', 'roms');
    const romDirs = await fsPoly.dirs(realRomDir);

    const scannedRealFiles = (await createRomScanner(romDirs).scan()).sort((a, b) =>
      a.getFilePath().localeCompare(b.getFilePath()),
    );

    // Given some symlinked dirs
    const tempDir = await fsPoly.mkdtemp(Temp.getTempDir());
    try {
      await Promise.all(
        romDirs.map(async (romDir, idx) => {
          const tempLink = path.join(tempDir, romDir);
          await fsPoly.mkdir(path.dirname(tempLink), { recursive: true });
          if (idx % 2 === 0) {
            // symlink some files with absolute paths
            await fsPoly.symlink(path.resolve(romDir), tempLink);
          } else {
            // symlink some files with relative paths
            await fsPoly.symlink(await fsPoly.symlinkRelativePath(romDir, tempLink), tempLink);
          }
        }),
      );

      // When scanning symlink dirs
      const scannedSymlinks = (await createRomScanner([tempDir]).scan()).sort((a, b) =>
        a.getFilePath().localeCompare(b.getFilePath()),
      );

      // Then the dirs scan successfully
      expect(scannedSymlinks).toHaveLength(scannedRealFiles.length);
      for (const [idx, scannedSymlink] of scannedSymlinks.entries()) {
        expect(scannedSymlink.getSize()).toEqual(scannedRealFiles[idx].getSize());
        expect(scannedSymlink.getCrc32()).toEqual(scannedRealFiles[idx].getCrc32());
      }
    } finally {
      await fsPoly.rm(tempDir, { recursive: true });
    }
  });
});

describe('single files', () => {
  it('should scan single files with no exclusions', async () => {
    await expect(createRomScanner(['test/fixtures/roms/empty.*']).scan()).resolves.toHaveLength(1);
    await expect(createRomScanner(['test/fixtures/*/empty.rom']).scan()).resolves.toHaveLength(1);
    await expect(createRomScanner(['test/fixtures/roms/empty.rom']).scan()).resolves.toHaveLength(
      1,
    );
  });
});