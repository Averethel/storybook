```js filename=".storybook/main.js|ts" renderer="common" language="js"
module.exports = {
  stories: ['../stories/**/*.stories.mdx', '../stories/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['@storybook/addon-links', '@storybook/addon-essentials'],
  features: {
    previewMdx2: true, // 👈 MDX 2 enabled here
  },
};
```
