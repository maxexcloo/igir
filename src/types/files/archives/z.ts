import SevenZip from './sevenZip.js';

export default class Z extends SevenZip {
  // eslint-disable-next-line class-methods-use-this
  protected new(filePath: string): SevenZip {
    return new Z(filePath);
  }

  static getExtensions(): string[] {
    return ['.z'];
  }

  // eslint-disable-next-line class-methods-use-this
  getExtension(): string {
    return Z.getExtensions()[0];
  }
}
