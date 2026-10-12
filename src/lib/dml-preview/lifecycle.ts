export function createPreviewLifecycle() {
  let generation = 0;
  let disposed = false;
  return {
    current(): number {
      return generation;
    },
    next(): number {
      generation += 1;
      return generation;
    },
    decide(accepted: boolean, token: number): boolean {
      return accepted && !disposed && token === generation;
    },
    disposed(): boolean {
      return disposed;
    },
    dispose(): void {
      disposed = true;
      generation += 1;
    },
  };
}

export type PreviewLifecycle = ReturnType<typeof createPreviewLifecycle>;

export function attachPreviewLifecycle(ref: { current: PreviewLifecycle | null }): () => void {
  const lifecycle = ref.current && !ref.current.disposed() ? ref.current : createPreviewLifecycle();
  ref.current = lifecycle;
  return () => {
    lifecycle.dispose();
  };
}
