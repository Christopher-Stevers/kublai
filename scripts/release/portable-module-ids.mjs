// Next's generated Flight-entry loader query includes absolute project paths.
// Normalize them only while webpack assigns IDs, preserving its usual ID
// algorithm and keeping all resolver, resource and cache identities untouched.
export class PortableModuleIdsPlugin {
  constructor(root) { this.root = root; }
  apply(compiler) {
    compiler.hooks.compilation.tap('PortableModuleIdsPlugin', compilation => {
      const originals = new Map();
      const normalize = modules => {
        for (const module of modules) {
          if (originals.has(module)) continue;
          const original = module.identifier;
          originals.set(module, original);
          module.identifier = () => original.call(module)
            .replaceAll(this.root + '/', '<project>/')
            .replaceAll(encodeURIComponent(this.root + '/'), encodeURIComponent('<project>/'));
        }
      };
      const restore = () => {
        for (const [module, original] of originals) module.identifier = original;
        originals.clear();
      };
      compilation.hooks.moduleIds.tap({ name: 'PortableModuleIdsPlugin', stage: -1000 }, normalize);
      compilation.hooks.moduleIds.tap({ name: 'PortableModuleIdsPlugin', stage: 1000 }, restore);
      compilation.hooks.chunkIds.tap({ name: 'PortableModuleIdsPlugin', stage: -1000 }, () => normalize(compilation.modules));
      compilation.hooks.chunkIds.tap({ name: 'PortableModuleIdsPlugin', stage: 1000 }, restore);
    });
  }
}
