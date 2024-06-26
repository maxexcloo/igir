import path from 'node:path';

import ProgressBar, { ProgressBarSymbol } from '../console/progressBar.js';
import fsPoly from '../polyfill/fsPoly.js';
import DAT from '../types/dats/dat.js';
import Options from '../types/options.js';
import OutputFactory from '../types/outputFactory.js';
import Module from './module.js';

/**
 * Write a DAT that was generated by {@link DATGameInferrer} to disk.
 */
export default class Dir2DatCreator extends Module {
  private readonly options: Options;

  constructor(options: Options, progressBar: ProgressBar) {
    super(progressBar, Dir2DatCreator.name);
    this.options = options;
  }

  /**
   * Write the DAT.
   */
  async create(dat: DAT): Promise<string | undefined> {
    if (!this.options.shouldDir2Dat()) {
      return undefined;
    }

    this.progressBar.logTrace(`${dat.getNameShort()}: writing dir2dat`);
    await this.progressBar.setSymbol(ProgressBarSymbol.WRITING);
    await this.progressBar.reset(1);

    const datDir = this.options.shouldWrite()
      ? OutputFactory.getDir(this.options, dat)
      : process.cwd();
    if (!await fsPoly.exists(datDir)) {
      await fsPoly.mkdir(datDir, { recursive: true });
    }
    const datPath = path.join(datDir, dat.getFilename());

    this.progressBar.logInfo(`${dat.getNameShort()}: creating dir2dat '${datPath}'`);
    const datContents = dat.toXmlDat();
    await fsPoly.writeFile(datPath, datContents);

    this.progressBar.logTrace(`${dat.getNameShort()}: done writing dir2dat`);
    return datPath;
  }
}
