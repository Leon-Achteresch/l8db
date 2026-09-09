type Rectangle = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

interface Options {
  panel: Rectangle;
  currentOffset: number;
  obstructions: readonly Rectangle[];
  gap?: number;
}

function overlapsHorizontally(first: Rectangle, second: Rectangle) {
  return first.left < second.right && first.right > second.left;
}

export function overviewVerticalOffset({ panel, currentOffset, obstructions, gap = 16 }: Options) {
  const basePanel = {
    ...panel,
    top: panel.top - currentOffset,
    bottom: panel.bottom - currentOffset,
  };

  return obstructions.reduce((offset, obstruction) => {
    if (
      !overlapsHorizontally(basePanel, obstruction) ||
      obstruction.bottom <= basePanel.top ||
      obstruction.top >= basePanel.bottom
    ) {
      return offset;
    }
    return Math.min(offset, obstruction.top - basePanel.bottom - gap);
  }, 0);
}
