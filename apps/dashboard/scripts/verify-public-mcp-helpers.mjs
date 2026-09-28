export async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await task(items[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

export async function retryServerFailure(
  task,
  {
    attempts = 3,
    wait = () => new Promise((resolve) => setTimeout(resolve, 250)),
  } = {},
) {
  let result;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await task();
    if (result.response.status < 500 || attempt === attempts) return result;
    await wait();
  }
  return result;
}
