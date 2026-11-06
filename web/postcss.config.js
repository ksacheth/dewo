import prefixer from "postcss-prefix-selector"

// The landing page's CSS is global (element selectors like h1, p, footer). Scope every rule to `.landing`
// so it cannot touch the app panels. Only files under src/landing are rewritten.
export default {
  plugins: [
    prefixer({
      prefix: ".landing",
      includeFiles: [/src[\\/]landing[\\/].*\.css$/],
      transform: (prefix, selector, prefixed) => (/^(:root|html|body)$/.test(selector) ? prefix : prefixed),
    }),
  ],
}
