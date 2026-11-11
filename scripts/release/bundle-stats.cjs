const fs = require('node:fs');
const path = require('node:path');

/** Observe the canonical client compilation. No compiler/chunking options or
 * generated modules are changed; source text and build secrets are not emitted. */
class ForemanBundleStats {
  /** @param {{ options: { output: { path: string } }, hooks: { done: {
   * tap: (name: string, callback: (stats: {
   * toJson: (options: Record<string, boolean | number>) => unknown
   * }) => void) => void
   * } } }} compiler */
  apply(compiler) {
    compiler.hooks.done.tap('ForemanBundleStats', stats => {
      const output = path.join(compiler.options.output.path, 'analysis', 'client-stats.json');
      const data = stats.toJson({
        all: false, assets: true, chunks: true, chunkModules: true,
        modules: true, nestedModules: true, ids: true, source: false,
        chunkModulesSpace: Infinity, modulesSpace: Infinity, nestedModulesSpace: Infinity,
        groupModulesByPath: false, groupModulesByExtension: false,
        groupModulesByType: false, groupModulesByAttributes: false,
        groupModulesByCacheStatus: false, groupModulesByLayer: false,
      });
      fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.writeFileSync(output, JSON.stringify({
        version: 1, sourceBuild: process.env.RELEASE_BUILD_ID,
        compiler: 'canonical-webpack-client',
        method: 'Webpack module sizes are pre-minification estimates. Compressed chunk bytes are measured separately from emitted files.',
        stats: data,
      }) + '\n');
    });
  }
}
module.exports = { ForemanBundleStats };
