```js filename=".storybook/main.js" renderer="common" language="js"
module.exports = {
  stories: [],
  addons: [
    // Other Storybook addons
  ],
  features: {
    buildStoriesJson: true, // 👈 Enable this to build the stories.json file
  },
};
```
