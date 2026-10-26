const { execFileSync } = require('node:child_process');

function createBuildInfo(root, version, variant, perf = false) {
  if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version) || !['legacy', 'modern'].includes(variant))
    throw new Error('Invalid build version or variant');
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = git(['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(commit)) throw new Error('Cannot identify the source commit');
  return { version, commit, variant, dirty: git(['status', '--porcelain']).length > 0, instrumentation: perf ? 'perf' : 'none' };
}

class BuildInfoAssetPlugin {
  constructor(info) { this.info = info; }
  apply(compiler) {
    compiler.hooks.thisCompilation.tap('BuildInfo', compilation => {
      compilation.hooks.processAssets.tap({ name: 'BuildInfo', stage: compiler.webpack.Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL }, () => {
        compilation.emitAsset('build-info.json', new compiler.webpack.sources.RawSource(`${JSON.stringify(this.info, null, 2)}\n`));
      });
    });
  }
}

module.exports = { createBuildInfo, BuildInfoAssetPlugin };
