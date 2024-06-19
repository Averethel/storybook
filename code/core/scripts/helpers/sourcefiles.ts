import { join } from 'node:path';
import { readdir } from 'node:fs/promises';
import { dedent, prettier, getWorkspace, esbuild } from '../../../../scripts/prepare/tools';
import { temporaryFile } from '../../src/common/utils/cli';

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:3000', width: 1920, height: 1080 });

// read code/frameworks subfolders and generate a list of available frameworks
// save this list into ./code/core/src/types/frameworks.ts and export it as a union type.
// The name of the type is `SupportedFrameworks`. Add additionally 'qwik' and `solid` to that list.
export const generateSourceFiles = async () => {
  const location = join(import.meta.dirname, '..', '..', 'src');
  const prettierConfig = await prettier.resolveConfig(location);

  await Promise.all([
    //
    generateFrameworksFile(prettierConfig),
    generateVersionsFile(prettierConfig),
    generateExportsFile(prettierConfig),
  ]);
};

async function generateVersionsFile(prettierConfig: prettier.Options | null): Promise<void> {
  const location = join(import.meta.dirname, '..', '..', 'src', 'common', 'versions.ts');

  const workspace = await getWorkspace();

  const versions = JSON.stringify(
    workspace
      .sort((a, b) => a.path.localeCompare(b.path))
      .reduce<Record<string, string>>((acc, i) => {
        if (i.publishConfig && i.publishConfig.access === 'public') {
          acc[i.name] = i.version;
        }
        return acc;
      }, {})
  );

  await Bun.write(
    location,
    await prettier.format(
      dedent`
        // auto generated file, do not edit
        export default ${versions};
      `,
      {
        ...prettierConfig,
        parser: 'typescript',
      }
    )
  );
}

async function generateFrameworksFile(prettierConfig: prettier.Options | null): Promise<void> {
  const thirdPartyFrameworks = ['qwik', 'solid'];
  const location = join(
    import.meta.dirname,
    '..',
    '..',
    'src',
    'types',
    'modules',
    'frameworks.ts'
  );
  const frameworksDirectory = join(import.meta.dirname, '..', '..', '..', 'frameworks');

  const readFrameworks = await readdir(frameworksDirectory);
  const frameworks = [...readFrameworks.sort(), ...thirdPartyFrameworks]
    .map((framework) => `'${framework}'`)
    .join(' | ');

  await Bun.write(
    location,
    await prettier.format(
      dedent`
        // auto generated file, do not edit
        export type SupportedFrameworks = ${frameworks};
      `,
      {
        ...prettierConfig,
        parser: 'typescript',
      }
    )
  );
}

async function generateExportsFile(prettierConfig: prettier.Options | null): Promise<void> {
  function removeDefault(input: string) {
    return input !== 'default';
  }

  const location = join(import.meta.dirname, '..', '..', 'src', 'manager', 'globals', 'exports.ts');

  const { globalsNameReferenceMap } = await import('../../src/manager/globals/globals');

  const grouped = Object.entries(globalsNameReferenceMap).reduce<Record<string, string[]>>(
    (acc, [key, value]) => {
      acc[value] = [...(acc[value] || []), key];
      return acc;
    },
    {}
  );

  const r = await Promise.all(
    Object.values(grouped).map(async (pkgs) => {
      // We bundle the target, into a single file to a temporary location
      // then we import the file and get the named exports of the module
      // we need to ensure to have happy-dom globally registered before running this
      // we do this so we can get the named exports of the module and generating those, independently from anything else.
      // due to esbuild being so fast, this is fine.
      // we can't load the module directly, because we'd need to compile things from @storybook/core first, which creates a cyclical dependence
      // esbuild allows us to alias anything from @storybook/core to the local source
      const l = await temporaryFile({ extension: 'js' });
      const all = await Promise.all(
        pkgs.map(async (pkg) => {
          if (pkg.startsWith('@storybook/')) {
            await esbuild.build({
              entryPoints: [pkg],
              bundle: true,
              format: 'esm',
              drop: ['console'],
              outfile: l,
              alias: {
                '@storybook/core': join(import.meta.dirname, '..', '..', 'src'),
              },
              legalComments: 'none',
              splitting: false,
              platform: 'browser',
              target: 'chrome100',
            });

            const mod = await import(l);
            return Object.keys(mod).filter(removeDefault).sort();
          }
          const mod = await import(pkg);
          return Object.keys(mod).filter(removeDefault).sort();
        })
      );
      return { pkgs, e: all.find((a) => a.length > 0) };
    })
  );

  const data: Record<string, string[]> = {};

  for (const { pkgs, e } of r) {
    for (const pkg of pkgs) {
      data[pkg] = e || [];
    }
  }

  await Bun.write(
    location,
    await prettier.format(
      dedent`
      // this file is generated by sourcefiles.ts
      // this is done to prevent runtime dependencies from making it's way into the build/start script of the manager
      // the manager builder needs to know which dependencies are 'globalized' in the ui
      
      export default ${JSON.stringify(data)} as const;
    `,
      {
        ...prettierConfig,
        parser: 'typescript',
      }
    )
  );
}
