type DropHandler = (paths: string[]) => void;

let handler: DropHandler | null = null;

export function setBucketDropHandler(next: DropHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function takeBucketDrop(paths: string[]): boolean {
  if (!handler || paths.length === 0) return false;
  handler(paths);
  return true;
}
