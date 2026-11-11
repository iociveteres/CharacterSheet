/** A bonus with its sign: "+3", "-2", "+0". */
export function signed(n: number): string {
    return n < 0 ? String(n) : `+${n}`;
}
