export function reportScenario(name: string, values: Record<string, unknown>) {
  console.log(`performance ${name}: ${JSON.stringify(values)}`);
}

export async function measureScenario(run: () => void | Promise<void>, runs = 9) {
  await run();
  await run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const started = performance.now();
    await run();
    durations.push(performance.now() - started);
  }
  durations.sort((left, right) => left - right);
  return {
    runs,
    medianMs: durations[Math.floor(durations.length / 2)],
    p95Ms: durations[Math.ceil(durations.length * 0.95) - 1],
    maxMs: durations.at(-1),
  };
}
