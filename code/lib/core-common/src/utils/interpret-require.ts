import { getInterpretedFileWithExt } from './interpret-files';

export function interopRequireDefault(filePath: string) {
  const { register } = require('esbuild-register/dist/node');
  const { unregister } = register({
    target: `node${process.version.slice(1)}`,
    format: 'cjs',
    hookIgnoreNodeModules: true,
    // Some frameworks, like Stylus, rely on the 'name' property of classes or functions
    // https://github.com/storybookjs/storybook/issues/19049
    keepNames: true,
    tsconfigRaw: `{
      "compilerOptions": {
        "strict": false,
        "skipLibCheck": true,
      },
    }`,
  });

  console.log({ filePath });

  const result = require(filePath);

  console.log({ result });

  unregister();

  const isES6DefaultExported =
    typeof result === 'object' && result !== null && typeof result.default !== 'undefined';

  return isES6DefaultExported ? result.default : result;
}

function getCandidate(paths: string[]) {
  for (let i = 0; i < paths.length; i += 1) {
    const candidate = getInterpretedFileWithExt(paths[i]);

    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export function serverRequire(filePath: string | string[]) {
  const candidatePath = serverResolve(filePath);

  if (!candidatePath) {
    return null;
  }

  return interopRequireDefault(candidatePath);
}

export function serverResolve(filePath: string | string[]): string | null {
  const paths = Array.isArray(filePath) ? filePath : [filePath];
  const existingCandidate = getCandidate(paths);

  if (!existingCandidate) {
    return null;
  }

  return existingCandidate.path;
}
