import prefixer from "postcss-prefix-selector"

// The landing page's CSS is global (element selectors like h1, p, footer). Scope every rule to `.landing`
// so it cannot touch the app panels. Only files under src/landing are rewritten.
export default {
  plugins: [
    prefixer({
      prefix: ".landing",
      includeFiles: [/src[\\/]landing[\\/].*\.css$/],
      // `html` keeps its own element (scroll-behavior and scroll-padding only work on the scroller), gated by a class the
      // Landing component sets on <html> while it is mounted.
      transform: (prefix, selector, prefixed) => (selector === "html" ? "html.landing-root" : /^(:root|body)$/.test(selector) ? prefix : prefixed),
    }),
  ],
}
