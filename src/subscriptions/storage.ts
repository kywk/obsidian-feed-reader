export interface SubscriptionStorage {
  read(path: string): Promise<string | null>;
  write(path: string, contents: string): Promise<void>;
  watch?(path: string, onChange: () => void): () => void;
}
