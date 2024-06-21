/* eslint-disable no-underscore-dangle */
/* eslint-disable @typescript-eslint/naming-convention */
import { type CleanupCallback, isExportStory } from '@storybook/csf';
import dedent from 'ts-dedent';
import type {
  Args,
  ComponentAnnotations,
  ComposedStoryFn,
  ComposedStoryPlayFn,
  ComposeStoryFn,
  LegacyStoryAnnotationsOrFn,
  NamedOrDefaultProjectAnnotations,
  Parameters,
  PlayFunction,
  PlayFunctionContext,
  PreparedStory,
  ProjectAnnotations,
  Renderer,
  StepLabel,
  Store_CSFExports,
  StoryContext,
  StrictArgTypes,
} from '@storybook/types';

import { HooksContext } from '../../../addons';
import { composeConfigs } from './composeConfigs';
import { prepareContext, prepareStory } from './prepareStory';
import { normalizeStory } from './normalizeStory';
import { normalizeComponentAnnotations } from './normalizeComponentAnnotations';
import { getValuesFromArgTypes } from './getValuesFromArgTypes';
import { normalizeProjectAnnotations } from './normalizeProjectAnnotations';
import { getUsedProps } from '../../../modules/preview-web/render/mount-utils';
import { MountMustBeDestructured } from '@storybook/core-events/preview-errors';

let globalProjectAnnotations: ProjectAnnotations<any> = {};

const DEFAULT_STORY_TITLE = 'ComposedStory';
const DEFAULT_STORY_NAME = 'Unnamed Story';

function extractAnnotation<TRenderer extends Renderer = Renderer>(
  annotation: NamedOrDefaultProjectAnnotations<TRenderer>
) {
  // support imports such as
  // import * as annotations from '.storybook/preview'
  // in both cases: 1 - the file has a default export; 2 - named exports only
  return 'default' in annotation ? annotation.default : annotation;
}

export function setProjectAnnotations<TRenderer extends Renderer = Renderer>(
  projectAnnotations:
    | NamedOrDefaultProjectAnnotations<TRenderer>
    | NamedOrDefaultProjectAnnotations<TRenderer>[]
) {
  const annotations = Array.isArray(projectAnnotations) ? projectAnnotations : [projectAnnotations];
  globalProjectAnnotations = composeConfigs(annotations.map(extractAnnotation));
}

const cleanups: { storyName: string; callback: CleanupCallback }[] = [];

export function composeStory<TRenderer extends Renderer = Renderer, TArgs extends Args = Args>(
  storyAnnotations: LegacyStoryAnnotationsOrFn<TRenderer>,
  componentAnnotations: ComponentAnnotations<TRenderer, TArgs>,
  projectAnnotations?: ProjectAnnotations<TRenderer>,
  defaultConfig?: ProjectAnnotations<TRenderer>,
  exportsName?: string
): ComposedStoryFn<TRenderer, Partial<TArgs>> {
  if (storyAnnotations === undefined) {
    // eslint-disable-next-line local-rules/no-uncategorized-errors
    throw new Error('Expected a story but received undefined.');
  }

  // @TODO: Support auto title

  componentAnnotations.title = componentAnnotations.title ?? DEFAULT_STORY_TITLE;
  const normalizedComponentAnnotations =
    normalizeComponentAnnotations<TRenderer>(componentAnnotations);

  const storyName =
    exportsName ||
    storyAnnotations.storyName ||
    storyAnnotations.story?.name ||
    storyAnnotations.name ||
    DEFAULT_STORY_NAME;

  const normalizedStory = normalizeStory<TRenderer>(
    storyName,
    storyAnnotations,
    normalizedComponentAnnotations
  );

  const normalizedProjectAnnotations = normalizeProjectAnnotations<TRenderer>(
    composeConfigs([defaultConfig ?? {}, globalProjectAnnotations, projectAnnotations ?? {}])
  );

  // We don't use the mount from prepareStory yet for portable stories.
  // mount needs to be provided by the user (e.g. using testing-library)
  const story = prepareStory<TRenderer>(
    normalizedStory,
    normalizedComponentAnnotations,
    normalizedProjectAnnotations
  );

  const globalsFromGlobalTypes = getValuesFromArgTypes(normalizedProjectAnnotations.globalTypes);

  const context = {
    hooks: new HooksContext(),
    globals: {
      ...globalsFromGlobalTypes,
      ...normalizedProjectAnnotations.globals,
    },
    args: { ...story.initialArgs },
    viewMode: 'story',
    loaded: {},
    abortSignal: new AbortController().signal,
    step: (label: StepLabel, play: PlayFunction<TRenderer>) => story.runStep!(label, play, context),
    canvasElement: globalThis?.document?.body,
    ...story,
  } as unknown as StoryContext<TRenderer>;

  context.context = context;
  context.mount = story.mount(context);

  const playFunction = (extraContext: Partial<PlayFunctionContext<TRenderer, TArgs>>) => {
    Object.assign(context, extraContext);
    return playStory(story, context);
  };

  let previousCleanupsDone = false;

  const composedStory: ComposedStoryFn<TRenderer, Partial<TArgs>> = Object.assign(
    function storyFn(extraArgs?: Partial<TArgs>) {
      context.args = {
        ...context.initialArgs,
        ...extraArgs,
      };

      if (cleanups.length > 0 && !previousCleanupsDone) {
        let humanReadableIdentifier = storyName;
        if (story.title !== DEFAULT_STORY_TITLE) {
          // prefix with title unless it's the generic ComposedStory title
          humanReadableIdentifier = `${story.title} - ${humanReadableIdentifier}`;
        }
        if (storyName === DEFAULT_STORY_NAME && Object.keys(context.args).length > 0) {
          // suffix with args if it's an unnamed story and there are args
          humanReadableIdentifier = `${humanReadableIdentifier} (${Object.keys(context.args).join(
            ', '
          )})`;
        }
        console.warn(
          dedent`Some stories were not cleaned up before rendering '${humanReadableIdentifier}'.
          
          You should load the story with \`await Story.load()\` before rendering it.`
        );
        // TODO: Add a link to the docs when they are ready
        // eg. "See https://storybook.js.org/docs/api/portable-stories-${process.env.JEST_WORKER_ID !== undefined ? 'jest' : 'vitest'}#3-load for more information."
      }
      return story.unboundStoryFn(prepareContext(context));
    },
    {
      id: story.id,
      storyName,
      load: async () => {
        // First run any registered cleanup function
        for (const { callback } of [...cleanups].reverse()) await callback();
        cleanups.length = 0;

        previousCleanupsDone = true;

        context.loaded = await story.applyLoaders(context);

        cleanups.push(
          ...(await story.applyBeforeEach(context))
            .filter(Boolean)
            .map((callback) => ({ storyName, callback }))
        );
      },
      args: story.initialArgs as Partial<TArgs>,
      parameters: story.parameters as Parameters,
      argTypes: story.argTypes as StrictArgTypes<TArgs>,
      play: playFunction as ComposedStoryPlayFn<TRenderer, TArgs>,
    }
  );

  return composedStory;
}

export function composeStories<TModule extends Store_CSFExports>(
  storiesImport: TModule,
  globalConfig: ProjectAnnotations<Renderer>,
  composeStoryFn: ComposeStoryFn
) {
  const { default: meta, __esModule, __namedExportsOrder, ...stories } = storiesImport;
  const composedStories = Object.entries(stories).reduce((storiesMap, [exportsName, story]) => {
    if (!isExportStory(exportsName, meta)) {
      return storiesMap;
    }

    const result = Object.assign(storiesMap, {
      [exportsName]: composeStoryFn(
        story as LegacyStoryAnnotationsOrFn,
        meta,
        globalConfig,
        exportsName
      ),
    });
    return result;
  }, {});

  return composedStories;
}

type WrappedStoryRef = { __pw_type: 'jsx' | 'importRef' };
type UnwrappedJSXStoryRef = {
  __pw_type: 'jsx';
  type: ComposedStoryFn;
};
type UnwrappedImportStoryRef = ComposedStoryFn;

declare global {
  function __pwUnwrapObject(
    storyRef: WrappedStoryRef
  ): Promise<UnwrappedJSXStoryRef | UnwrappedImportStoryRef>;
}

export function createPlaywrightTest<TFixture extends { extend: any }>(
  baseTest: TFixture
): TFixture {
  return baseTest.extend({
    mount: async ({ mount, page }: any, use: any) => {
      await use(async (storyRef: WrappedStoryRef, ...restArgs: any) => {
        // Playwright CT deals with JSX import references differently than normal imports
        // and we can currently only handle JSX import references
        if (
          !('__pw_type' in storyRef) ||
          ('__pw_type' in storyRef && storyRef.__pw_type !== 'jsx')
        ) {
          // eslint-disable-next-line local-rules/no-uncategorized-errors
          throw new Error(dedent`
              Portable stories in Playwright CT only work when referencing JSX elements.
              Please use JSX format for your components such as:
              
              instead of:
              await mount(MyComponent, { props: { foo: 'bar' } })
              
              do:
              await mount(<MyComponent foo="bar"/>)

              More info: https://storybook.js.org/docs/api/portable-stories-playwright
            `);
        }

        await page.evaluate(async (wrappedStoryRef: WrappedStoryRef) => {
          const unwrappedStoryRef = await globalThis.__pwUnwrapObject?.(wrappedStoryRef);
          const story =
            '__pw_type' in unwrappedStoryRef ? unwrappedStoryRef.type : unwrappedStoryRef;
          return story?.load?.();
        }, storyRef);

        // mount the story
        const mountResult = await mount(storyRef, ...restArgs);

        // play the story in the browser
        await page.evaluate(async (wrappedStoryRef: WrappedStoryRef) => {
          const unwrappedStoryRef = await globalThis.__pwUnwrapObject?.(wrappedStoryRef);
          const story =
            '__pw_type' in unwrappedStoryRef ? unwrappedStoryRef.type : unwrappedStoryRef;
          const canvasElement = document.querySelector('#root');
          return story?.play?.({ canvasElement });
        }, storyRef);

        return mountResult;
      });
    },
  });
}

async function playStory<TRenderer extends Renderer>(
  story: PreparedStory<TRenderer>,
  context: StoryContext<TRenderer>
) {
  for (const { callback } of [...cleanups].reverse()) await callback();
  cleanups.length = 0;

  context.loaded = await story.applyLoaders(context);
  if (context.abortSignal.aborted) return;

  cleanups.push(
    ...(await story.applyBeforeEach(context))
      .filter(Boolean)
      .map((callback) => ({ storyName: story.name, callback }))
  );

  const playFunction = story.playFunction;

  const mountDestructured = playFunction && getUsedProps(playFunction).includes('mount');

  if (!mountDestructured) {
    await context.mount();
  }

  if (context.abortSignal.aborted) return;

  if (playFunction) {
    if (!mountDestructured) {
      context.mount = async () => {
        throw new MountMustBeDestructured({ playFunction: playFunction.toString() });
      };
    }
    await playFunction(context);
  }
}
