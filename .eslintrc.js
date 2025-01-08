module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: ["plugin:vue/essential", "standard"],
  parserOptions: {
    ecmaVersion: 12,
    sourceType: "module",
  },
  plugins: ["vue"],
  rules: {
    semi: ["error", "always"],
    "keyword-spacing": ["error", {}],

    quotes: 0,
    camelcase: 0,
    "no-multiple-empty-lines": 0,
    "padded-blocks": 0,
    "comma-dangle": 0,
    "space-in-parens": 0,
  },
};
