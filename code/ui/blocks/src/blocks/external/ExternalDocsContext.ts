import type { Renderer, CSFFile, ModuleExports, DocsContextProps } from '@storybook/core/types';
import { DocsContext } from '@storybook/core/preview-api';
import type { StoryStore } from '@storybook/core/preview-api';

export class ExternalDocsContext<TRenderer extends Renderer> extends DocsContext<TRenderer> {
  constructor(
    public channel: DocsContext<TRenderer>['channel'],
    protected store: StoryStore<TRenderer>,
    public renderStoryToElement: DocsContextProps['renderStoryToElement'],
    private processMetaExports: (metaExports: ModuleExports) => CSFFile<TRenderer>
  ) {
    super(channel, store, renderStoryToElement, []);
  }

  referenceMeta = (metaExports: ModuleExports, attach: boolean) => {
    const csfFile = this.processMetaExports(metaExports);
    this.referenceCSFFile(csfFile);
    super.referenceMeta(metaExports, attach);
  };
}
