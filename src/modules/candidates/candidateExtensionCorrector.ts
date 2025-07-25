import path from 'node:path';

import type { Semaphore } from 'async-mutex';

import type ProgressBar from '../../console/progressBar.js';
import { ProgressBarSymbol } from '../../console/progressBar.js';
import type DAT from '../../types/dats/dat.js';
import type ROM from '../../types/dats/rom.js';
import ArchiveEntry from '../../types/files/archives/archiveEntry.js';
import Chd from '../../types/files/archives/chd/chd.js';
import type FileFactory from '../../types/files/fileFactory.js';
import type FileSignature from '../../types/files/fileSignature.js';
import type Options from '../../types/options.js';
import { FixExtension } from '../../types/options.js';
import OutputFactory from '../../types/outputFactory.js';
import type ROMWithFiles from '../../types/romWithFiles.js';
import type WriteCandidate from '../../types/writeCandidate.js';
import Module from '../module.js';

/**
 * Correct the extensions of output {@link File}s when:
 *  1. Not using any DATs (i.e. there's no correction already happening elsewhere)
 *  2. The DAT-supplied ROM name is falsey
 */
export default class CandidateExtensionCorrector extends Module {
  private readonly options: Options;
  private readonly fileFactory: FileFactory;
  private readonly readerSemaphore: Semaphore;

  constructor(
    options: Options,
    progressBar: ProgressBar,
    fileFactory: FileFactory,
    readerSemaphore: Semaphore,
  ) {
    super(progressBar, CandidateExtensionCorrector.name);
    this.options = options;
    this.fileFactory = fileFactory;
    this.readerSemaphore = readerSemaphore;
  }

  /**
   * Correct the file extensions.
   */
  async correct(dat: DAT, candidates: WriteCandidate[]): Promise<WriteCandidate[]> {
    if (candidates.length === 0) {
      this.progressBar.logTrace(`${dat.getName()}: no candidates to correct extensions for`);
      return candidates;
    }

    const romsThatNeedCorrecting = candidates
      .flatMap((candidate) => candidate.getRomsWithFiles())
      .filter((romWithFiles) => this.romNeedsCorrecting(romWithFiles)).length;
    if (romsThatNeedCorrecting === 0) {
      this.progressBar.logTrace(`${dat.getName()}: no output files need their extension corrected`);
      return candidates;
    }

    this.progressBar.logTrace(
      `${dat.getName()}: correcting ${romsThatNeedCorrecting.toLocaleString()} output file extension${romsThatNeedCorrecting === 1 ? '' : 's'}`,
    );
    this.progressBar.setSymbol(ProgressBarSymbol.CANDIDATE_EXTENSION_CORRECTION);
    this.progressBar.resetProgress(romsThatNeedCorrecting);

    const correctedCandidates = await this.correctExtensions(dat, candidates);

    this.progressBar.logTrace(`${dat.getName()}: done correcting output file extensions`);
    return correctedCandidates;
  }

  private romNeedsCorrecting(romWithFiles: ROMWithFiles): boolean {
    if (romWithFiles.getRom().getName().trim() === '') {
      return true;
    }

    const inputFile = romWithFiles.getInputFile();
    if (inputFile instanceof ArchiveEntry && inputFile.getArchive() instanceof Chd) {
      // Files within CHDs never need extension correction
      return false;
    }

    return (
      this.options.getFixExtension() === FixExtension.ALWAYS ||
      (this.options.getFixExtension() === FixExtension.AUTO &&
        (!this.options.usingDats() || romWithFiles.getRom().getName().trim() === ''))
    );
  }

  private async correctExtensions(
    dat: DAT,
    candidates: WriteCandidate[],
  ): Promise<WriteCandidate[]> {
    return Promise.all(
      candidates.map(async (candidate) => {
        const hashedRomsWithFiles = await Promise.all(
          candidate.getRomsWithFiles().map(async (romWithFiles) => {
            const correctedRom = await this.buildCorrectedRom(dat, candidate, romWithFiles);

            // Using the corrected ROM name, build a new output path
            const correctedOutputPath = OutputFactory.getPath(
              this.options,
              dat,
              candidate.getGame(),
              correctedRom,
              romWithFiles.getInputFile(),
            );
            let correctedOutputFile = romWithFiles
              .getOutputFile()
              .withFilePath(correctedOutputPath.format());
            if (correctedOutputFile instanceof ArchiveEntry) {
              correctedOutputFile = correctedOutputFile.withEntryPath(
                correctedOutputPath.entryPath,
              );
            }

            return romWithFiles.withRom(correctedRom).withOutputFile(correctedOutputFile);
          }),
        );

        return candidate.withRomsWithFiles(hashedRomsWithFiles);
      }),
    );
  }

  private async buildCorrectedRom(
    dat: DAT,
    candidate: WriteCandidate,
    romWithFiles: ROMWithFiles,
  ): Promise<ROM> {
    let correctedRom = romWithFiles.getRom();

    if (correctedRom.getName().trim() === '') {
      // The ROM doesn't have any filename, default it. Because we never knew a file extension,
      // doing this isn't considered "correction".
      const romWithFilesIdx = candidate.getRomsWithFiles().indexOf(romWithFiles);
      correctedRom = correctedRom.withName(
        `${candidate
          .getGame()
          .getName()}${candidate.getRomsWithFiles().length > 1 ? ` (File ${romWithFilesIdx + 1})` : ''}.rom`,
      );
    }

    if (!this.romNeedsCorrecting(romWithFiles)) {
      // Do no further processing if we're not correcting the extension
      return correctedRom;
    }

    await this.readerSemaphore.runExclusive(async () => {
      this.progressBar.incrementInProgress();
      this.progressBar.logTrace(
        `${dat.getName()}: ${candidate.getName()}: correcting extension for: ${romWithFiles
          .getInputFile()
          .toString()}`,
      );
      const childBar = this.progressBar.addChildBar({
        name: romWithFiles.getInputFile().toString(),
      });

      try {
        let fileSignature: FileSignature | undefined;
        try {
          fileSignature = await this.fileFactory.signatureFrom(romWithFiles.getInputFile());
        } catch (error) {
          this.progressBar.logError(
            `${dat.getName()}: failed to correct file extension for '${romWithFiles
              .getInputFile()
              .toString()}': ${error}`,
          );
        }
        if (fileSignature) {
          // ROM file signature found, use the appropriate extension
          const { dir, name } = path.parse(correctedRom.getName());
          const correctedRomName = path.format({
            dir,
            name: name + fileSignature.getExtension(),
          });
          correctedRom = correctedRom.withName(correctedRomName);
        }
      } finally {
        childBar.delete();
      }

      this.progressBar.incrementCompleted();
    });

    return correctedRom;
  }
}
