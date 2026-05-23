// Lets tests import file contents as strings via Vite's `?raw` suffix
// (used by the docs-consistency guard). Vitest runs on Vite, which supports this.
declare module "*?raw" {
  const content: string;
  export default content;
}
