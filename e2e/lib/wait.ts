// Polling that works in hooks too, unlike expect.poll.

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Reads with `get` until `assert` passes; after `timeout` the last failure is thrown. */
export async function eventually<T>(get: () => Promise<T>, assert: (value: T) => void, timeout = 5000): Promise<T> {
    const end = Date.now() + timeout;
    for (; ;) {
        const value = await get();
        try {
            assert(value);
            return value;
        } catch (e) {
            if (Date.now() > end) throw e;
        }
        await sleep(50);
    }
}
