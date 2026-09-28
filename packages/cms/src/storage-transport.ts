export interface CmsStorageTransport {
  listFiles(dirPath: string): Promise<string[]>;
  readFile(filePath: string): Promise<string>;
  writeFile(
    filePath: string,
    content: string,
    options: { message: string },
  ): Promise<void>;
  deleteFile(filePath: string, options: { message: string }): Promise<void>;
}
