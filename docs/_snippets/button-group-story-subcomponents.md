```js filename="ButtonGroup.stories.js|jsx" renderer="common" language="js"
import { Button, ButtonGroup } from './ButtonGroup';

export default {
  /* 👇 The title prop is optional.
  * See https://storybook.js.org/docs/6/configure#configure-story-loading
  * to learn how to generate automatic titles
  */
  title: 'ButtonGroup',
  component: ButtonGroup,
  subcomponents: { Button },
};
```
```ts filename="ButtonGroup.stories.ts|tsx" renderer="common" language="ts"
import { Meta } from '@storybook/react';

import { Button, ButtonGroup } from './ButtonGroup';

export default {
  /* 👇 The title prop is optional.
  * See https://storybook.js.org/docs/6/configure#configure-story-loading
  * to learn how to generate automatic titles
  */
  title: 'ButtonGroup',
  component: ButtonGroup,
  subcomponents: { Button },
} as Meta;
```
