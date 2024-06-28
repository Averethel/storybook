import { execaCommand } from 'execa';
import fsExtra from 'fs-extra';
import chalk from 'chalk';
import path from 'path';
import program from 'commander';

import { runServer, parseConfigFile } from 'verdaccio';
import pLimit from 'p-limit';
import type { Server } from 'http';
import { mkdir } from 'fs/promises';
import { PACKS_DIRECTORY } from './utils/constants';

import { maxConcurrentTasks } from './utils/concurrency';
import { getWorkspaces } from './utils/workspace';
import { execa, execaSync } from 'execa';

program
  .option('-O, --open', 'keep process open')
  .option('-P, --publish', 'should publish packages');

program.parse(process.argv);

const logger = console;

const dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '..');

const startVerdaccio = async () => {
  let resolved = false;
  return Promise.race([
    new Promise((resolve) => {
      const cache = path.join(dirname, '..', '.verdaccio-cache');
      const config = {
        ...parseConfigFile(path.join(dirname, 'verdaccio.yaml')),
        self_path: cache,
      };

      // @ts-expect-error (verdaccio's interface is wrong)
      runServer(config).then((app: Server) => {
        app.listen(6001, () => {
          resolved = true;
          resolve(app);
        });
      });
    }),
    new Promise((_, rej) => {
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          rej(new Error(`TIMEOUT - verdaccio didn't start within 10s`));
        }
      }, 10000);
    }),
  ]) as Promise<Server>;
};

const currentVersion = async () => {
  const { version } = await fsExtra.readJSON(path.join(dirname, '..', 'code', 'package.json'));
  return version;
};

const publish = async (packages: { name: string; location: string }[], url: string) => {
  logger.log(`Publishing packages with a concurrency of ${maxConcurrentTasks}`);

  const limit = pLimit(maxConcurrentTasks);
  let i = 0;

  /**
   * We need to "pack" our packages before publishing to npm because our package.json files contain yarn specific version "ranges".
   * such as "workspace:*"
   *
   * We can't publish to npm if the package.json contains these ranges. So with `yarn pack` we create a tarball that we can publish.
   *
   * However this bug exists in NPM: https://github.com/npm/cli/issues/4533!
   * Which causes the NPM CLI to disregard the tarball CLI argument and instead re-create a tarball.
   * But NPM doesn't replace the yarn version ranges.
   *
   * So we create the tarball ourselves and move it to another location on the FS.
   * Then we change-directory to that directory and publish the tarball from there.
   */
  await mkdir(PACKS_DIRECTORY, { recursive: true }).catch(() => {});

  return Promise.all(
    packages.map(({ name, location }) =>
      limit(
        () =>
          new Promise<void>(async (res, rej) => {
            logger.log(
              `🛫 publishing ${name} (${location.replace(
                path.resolve(path.join(dirname, '..')),
                '.'
              )})`
            );

            const tarballFilename = `${name.replace('@', '').replace('/', '-')}.tgz`;
            const pathLocation = path.resolve('../code', location);
            try {
              await execaCommand(`yarn pack --out ${PACKS_DIRECTORY}/${tarballFilename}`, {
                cwd: pathLocation,
              });
              await execaCommand(
                `npm publish ${tarballFilename} --registry ${url} --force --ignore-scripts`,
                {
                  cwd: PACKS_DIRECTORY,
                }
              );
              i += 1;
              logger.log(`${i}/${packages.length} 🛬 successful publish of ${name}!`);
              res();
            } catch (e) {
              rej(e as any);
            }
          })
      )
    )
  );
};

const run = async () => {
  const verdaccioUrl = `http://localhost:6001`;

  logger.log(`📐 reading version of storybook`);
  logger.log(`🚛 listing storybook packages`);

  if (!process.env.CI) {
    // when running e2e locally, clear cache to avoid EPUBLISHCONFLICT errors
    const verdaccioCache = path.resolve(dirname, '..', '.verdaccio-cache');
    if (await fsExtra.pathExists(verdaccioCache)) {
      logger.log(`🗑 cleaning up cache`);
      await fsExtra.remove(verdaccioCache);
    }
  }

  logger.log(`🎬 starting verdaccio (this takes ±5 seconds, so be patient)`);

  const [verdaccioServer, packages, version] = await Promise.all([
    startVerdaccio(),
    getWorkspaces(false),
    currentVersion(),
  ]);

  logger.log(`🌿 verdaccio running on ${verdaccioUrl}`);

  logger.log(`👤 add temp user to verdaccio`);
  await execa(
    'npx',
    // creates a .npmrc file in the root directory of the project
    ['npm-auth-to-token', '-u', 'foo', '-p', 's3cret', '-e', 'test@test.com', '-r', verdaccioUrl],
    {
      cwd: root,
    }
  );

  logger.log(`📦 found ${packages.length} storybook packages at version ${chalk.blue(version)}`);

  if (program.publish) {
    await publish(packages, verdaccioUrl);
  }

  return new Promise<void>(async (res) => {
    await execa('npx', ['rimraf', '.npmrc'], { cwd: root });

    if (!program.open) {
      verdaccioServer.close(() => {
        res();
      });
    } else {
      res();
    }
  });
};

run().catch((e) => {
  logger.error(e);
  execaSync('npx', ['rimraf', '.npmrc'], { cwd: root });
  process.exit(1);
});
