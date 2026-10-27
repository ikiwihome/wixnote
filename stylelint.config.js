export default {
  extends: ['stylelint-config-recommended'],
  rules: {
    // Independent components and responsive/theme overrides intentionally use
    // different specificity. Validate declarations without reordering the cascade.
    'no-descending-specificity': null,
  },
};
