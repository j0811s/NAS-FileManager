/**
 * @type {import('lint-staged').Configuration}
 */
export default {
  "{apps,packages}/**/src/**/*.{js,ts,jsx,tsx}": ["oxfmt", "oxlint --fix"],
  "{apps,packages}/**/src/**/*.{ts,tsx}": () => "npm run typecheck --workspaces --if-present",
};
