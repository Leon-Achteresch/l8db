type DropHandler = (paths: string[], x: number, y: number) => boolean;

let handler: DropHandler | null = null;

export function setAiDropHandler(next: DropHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function takeAiDrop(paths: string[], position: { x: number; y: number }): boolean {
  if (!handler || !paths.length) return false;
  const scale = window.devicePixelRatio || 1;
  return handler(paths, position.x / scale, position.y / scale);
}
