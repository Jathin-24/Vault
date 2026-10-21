/**
 * Await a side-effect promise without letting a failure escape (cleanup
 * paths, best-effort logging). Result is ignored; errors go to the log.
 */
export async function bestEffort(
  work: PromiseLike<unknown>,
  label: string
): Promise<void> {
  try {
    await work;
  } catch (err) {
    console.error(`[best-effort] ${label}:`, err);
  }
}
