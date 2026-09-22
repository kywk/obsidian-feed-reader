export interface ReadStateStorage {
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
}
