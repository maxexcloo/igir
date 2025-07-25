import 'jest-extended';

import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { Semaphore } from 'async-mutex';

import DriveSemaphore from '../../../src/async/driveSemaphore.js';
import Logger from '../../../src/console/logger.js';
import { LogLevel } from '../../../src/console/logLevel.js';
import Temp from '../../../src/globals/temp.js';
import CandidateExtensionCorrector from '../../../src/modules/candidates/candidateExtensionCorrector.js';
import ROMScanner from '../../../src/modules/roms/romScanner.js';
import FsPoly from '../../../src/polyfill/fsPoly.js';
import Game from '../../../src/types/dats/game.js';
import Header from '../../../src/types/dats/logiqx/header.js';
import LogiqxDAT from '../../../src/types/dats/logiqx/logiqxDat.js';
import ROM from '../../../src/types/dats/rom.js';
import SingleValueGame from '../../../src/types/dats/singleValueGame.js';
import File from '../../../src/types/files/file.js';
import FileCache from '../../../src/types/files/fileCache.js';
import FileFactory from '../../../src/types/files/fileFactory.js';
import Options, { FixExtension, FixExtensionInverted } from '../../../src/types/options.js';
import ROMWithFiles from '../../../src/types/romWithFiles.js';
import WriteCandidate from '../../../src/types/writeCandidate.js';
import ProgressBarFake from '../../console/progressBarFake.js';

const LOGGER = new Logger(LogLevel.NEVER, new PassThrough());

it('should do nothing with no candidates', async () => {
  const options = new Options();
  const dat = new LogiqxDAT({ header: new Header() });
  const candidates: WriteCandidate[] = [];

  const correctedCandidates = await new CandidateExtensionCorrector(
    options,
    new ProgressBarFake(),
    new FileFactory(new FileCache(), LOGGER),
    new Semaphore(os.cpus().length),
  ).correct(dat, candidates);

  expect(correctedCandidates).toBe(candidates);
});

it('should do nothing when no ROMs need correcting', async () => {
  const options = new Options({
    fixExtension: FixExtensionInverted[FixExtension.AUTO].toLowerCase(),
  });
  const dat = new LogiqxDAT({
    header: new Header(),
    games: [
      new Game({
        name: 'game with no ROMs',
      }),
      new Game({
        name: 'game with one ROM',
        roms: new ROM({ name: 'one.rom', size: 1 }),
      }),
      new Game({
        name: 'game with two ROMs',
        roms: [new ROM({ name: 'two.rom', size: 2 }), new ROM({ name: 'three.rom', size: 3 })],
      }),
    ],
  });
  const candidates: WriteCandidate[] = [];

  const correctedCandidates = await new CandidateExtensionCorrector(
    options,
    new ProgressBarFake(),
    new FileFactory(new FileCache(), LOGGER),
    new Semaphore(os.cpus().length),
  ).correct(dat, candidates);

  expect(correctedCandidates).toBe(candidates);
});

function expectcorrectedCandidates(
  candidates: WriteCandidate[],
  correctedCandidates: WriteCandidate[],
): void {
  expect(correctedCandidates).not.toBe(candidates);

  // The candidates haven't changed
  expect(correctedCandidates).toHaveLength(candidates.length);

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates.at(i);
    const correctedCandidate = correctedCandidates.at(i);

    const romsWithFiles = candidate?.getRomsWithFiles();
    const correctedRomsWithFiles = correctedCandidate?.getRomsWithFiles();

    // The candidate has the same number of ROMWithFiles
    expect(correctedRomsWithFiles).toHaveLength(romsWithFiles?.length ?? -1);

    for (let j = 0; j < (romsWithFiles?.length ?? 0); j += 1) {
      const romWithFiles = romsWithFiles?.at(j);
      const correctedRomWithFiles = correctedRomsWithFiles?.at(j);

      // The input file hasn't changed
      expect(correctedRomWithFiles?.getInputFile()).toBe(romWithFiles?.getInputFile());

      // The output file path has changed
      expect(correctedRomWithFiles?.getOutputFile().getFilePath()).not.toEqual(
        romWithFiles?.getOutputFile().getFilePath(),
      );
    }
  }
}

it('should correct ROMs without DATs', async () => {
  const options = new Options({
    // No DAT has been provided, therefore all ROMs should be corrected
    input: [path.join('test', 'fixtures', 'roms', 'headered')],
    fixExtension: FixExtensionInverted[FixExtension.AUTO].toLowerCase(),
  });
  const dat = new LogiqxDAT({ header: new Header() });
  const inputFiles = await new ROMScanner(
    options,
    new ProgressBarFake(),
    new FileFactory(new FileCache(), LOGGER),
    new DriveSemaphore(os.cpus().length),
  ).scan();

  const tempDir = await FsPoly.mkdtemp(Temp.getTempDir());
  try {
    const tempFiles = await Promise.all(
      inputFiles.map(async (inputFile) => {
        const tempFile = path.join(tempDir, path.basename(inputFile.getExtractedFilePath()));
        await inputFile.extractToFile(tempFile);
        return File.fileOf({ filePath: tempFile });
      }),
    );

    const candidates = tempFiles.map((tempFile) => {
      const roms = [
        new ROM({
          name: path.basename(tempFile.getFilePath()),
          size: tempFile.getSize(),
        }),
      ];
      const game = new SingleValueGame({
        name: path.parse(tempFile.getFilePath()).name,
        roms: roms,
      });
      const romsWithFiles = roms.map((rom) => {
        const { dir, name } = path.parse(tempFile.getFilePath());
        // Use a dummy path for the output, so we can know if it changed or not
        const outputFile = tempFile.withFilePath(`${path.format({ dir, name })}.rom`);
        return new ROMWithFiles(rom, tempFile, outputFile);
      });
      return new WriteCandidate(game, romsWithFiles);
    });

    const correctedCandidates = await new CandidateExtensionCorrector(
      options,
      new ProgressBarFake(),
      new FileFactory(new FileCache(), LOGGER),
      new Semaphore(os.cpus().length),
    ).correct(dat, candidates);

    expectcorrectedCandidates(candidates, correctedCandidates);
  } finally {
    await FsPoly.rm(tempDir, { recursive: true, force: true });
  }
});

it('should correct ROMs with missing filenames', async () => {
  const options = new Options({
    dat: [path.join('test', 'fixtures', 'dats')],
    input: [path.join('test', 'fixtures', 'roms', 'headered')],
    fixExtension: FixExtensionInverted[FixExtension.AUTO].toLowerCase(),
  });
  const dat = new LogiqxDAT({ header: new Header() });
  const inputFiles = await new ROMScanner(
    options,
    new ProgressBarFake(),
    new FileFactory(new FileCache(), LOGGER),
    new DriveSemaphore(os.cpus().length),
  ).scan();

  const tempDir = await FsPoly.mkdtemp(Temp.getTempDir());
  try {
    const tempFiles = await Promise.all(
      inputFiles.map(async (inputFile) => {
        const tempFile = path.join(tempDir, path.basename(inputFile.getExtractedFilePath()));
        await inputFile.extractToFile(tempFile);
        return File.fileOf({ filePath: tempFile });
      }),
    );

    const candidates = tempFiles.map((tempFile) => {
      // No ROM in the DAT has a filename, therefore all of them should be corrected
      const roms = [new ROM({ name: '', size: tempFile.getSize() })];
      const game = new SingleValueGame({
        name: path.parse(tempFile.getFilePath()).name,
        roms: roms,
      });
      const romsWithFiles = roms.map((rom) => {
        const { dir, name } = path.parse(tempFile.getFilePath());
        // Use a dummy path for the output, so we can know if it changed or not
        const outputFile = tempFile.withFilePath(`${path.format({ dir, name })}.rom`);
        return new ROMWithFiles(rom, tempFile, outputFile);
      });
      return new WriteCandidate(game, romsWithFiles);
    });

    const correctedCandidates = await new CandidateExtensionCorrector(
      options,
      new ProgressBarFake(),
      new FileFactory(new FileCache(), LOGGER),
      new Semaphore(os.cpus().length),
    ).correct(dat, candidates);

    expectcorrectedCandidates(candidates, correctedCandidates);
  } finally {
    await FsPoly.rm(tempDir, { recursive: true, force: true });
  }
});
