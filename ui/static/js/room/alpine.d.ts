// @alpinejs/csp ships no types. The room uses this much of it.
declare module "@alpinejs/csp" {
    const Alpine: {
        store(name: string, value: object): void;
        data(name: string, callback: () => object): void;
        start(): void;
    };
    export default Alpine;
}
