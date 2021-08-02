/* eslint-disable */
'use strict';

const builtins = [
	'assert',
	'async_hooks',
	'buffer',
	'child_process',
	'cluster',
	'console',
	'constants',
	'crypto',
	'dgram',
	'dns',
	'domain',
	'events',
	'fs',
	'http',
	'http2',
	'https',
	'inspector',
	'module',
	'net',
	'os',
	'path',
	'perf_hooks',
	'process',
	'punycode',
	'querystring',
	'readline',
	'repl',
	'stream',
	'string_decoder',
	'timers',
	'tls',
	'trace_events',
	'tty',
	'url',
	'util',
	'v8',
	'vm',
	'wasi',
	'worker_threads',
	'zlib',
];

const __importDefault = (this && this.__importDefault) || function(mod) {
	return (mod && mod.__esModule) ? mod : { 'default': mod };
};
Object.defineProperty(exports, '__esModule', { value: true });
exports.createFsRequire = void 0;
const vm_1 = __importDefault(require('vm'));
const path_1 = __importDefault(require('path'));
const module_1 = __importDefault(require('module'));
const types_1 = require('./types');
const utils_1 = require('./utils');
const loaders = {
	'': undefined,
	'.js': undefined,
	'.json': undefined,
};
/**
 * Extensionless JS files
 * Takes priority over .js file
 */
loaders[''] = function(newModule, sourceCode, makeRequire, filename, id) {
	const moduleWrappedSourceCode = module_1.default.wrap(sourceCode);
	// Reference: https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js#L1028
	vm_1.default.runInThisContext(moduleWrappedSourceCode, {
		filename: `fs-require://${id}${filename}`,
		lineOffset: 0,
		displayErrors: true,
	})(newModule.exports, makeRequire(newModule), newModule, path_1.default.basename(filename), path_1.default.dirname(filename));
};
loaders['.js'] = loaders[''];
loaders['.json'] = function(newModule, sourceCode) {
	newModule.exports = JSON.parse(sourceCode);
};
function resolveImplicitExtension(fs, filePath) {
	for (const extension of types_1.loaderTypes) {
		const filePathWithExtension = filePath + extension;
		if (fs.existsSync(filePathWithExtension)) {
			return {
				extension: path_1.default.extname(filePathWithExtension),
				filePath: filePathWithExtension,
			};
		}
	}

	return null;
}

function findSubNodeModulesDirectory(fs, dirPath) {
	const lastPathParts = dirPath.split(/[\\\\/]+/g);

	for (let i = lastPathParts.length - 1; i >= 0; i--) {
		const testedPath = path_1.default.join((process.platform === "win32") ? '' : '/', ...lastPathParts.slice(0, i + 1), 'node_modules');
		if (fs.existsSync(testedPath)) {
			return testedPath;
		}
	}
}

function folderExistsInDirectory(fs, dirPath, modulePath) {
	return fs.existsSync(path_1.default.resolve(dirPath, modulePath));
}

const realRequire = require;
let idCounter = 0;
const createPatchedRequire = (mfs, customResolver, mocked) => {
	idCounter += 1;
	const fsRequireId = idCounter;
	const moduleCache = new Map();
	function makeRequireFunction(parentModule) {
    const resolve = (modulePath) => {
      let independentModule = Boolean(!utils_1.isFilePathPattern.test(modulePath));

      const parentModuleNodeModulesPath = (!utils_1.isFilePathPattern.test(modulePath)) ? findSubNodeModulesDirectory(mfs, parentModule.filename) : '';
			let filename;

			if (!independentModule) {
				if (parentModuleNodeModulesPath) {
					filename = path_1.default.resolve(path_1.default.dirname(parentModule.filename), parentModuleNodeModulesPath, modulePath);
				} else {
					filename = path_1.default.resolve(path_1.default.dirname(parentModule.filename), modulePath);
				}
			} else if ((((parentModuleNodeModulesPath || '').match(/node_modules/g) || []).length > 1) &&
                folderExistsInDirectory(mfs, parentModuleNodeModulesPath, modulePath)) {
				filename = path_1.default.resolve(parentModuleNodeModulesPath, modulePath);
			} else {
				filename = modulePath;
			}

			if (customResolver) filename = customResolver(filename);

			const isDirectory = utils_1.isDirectory(mfs, filename);

			let foundMain = false;
			// read the package.json if it exists and add the main to the module path
			if (isDirectory) {
				const packageJsonPath = path_1.default.join(filename, 'package.json');
				if (mfs.existsSync(packageJsonPath)) {
					path_1.default.join(filename, 'package.json');
					const packageJson = JSON.parse(mfs.readFileSync(packageJsonPath, 'utf8'));
					if (packageJson.main) {
						filename = path_1.default.join(filename, packageJson.main);
						foundMain = true;
					}
				}
			}

			let resolvedPath;

			if (utils_1.isDirectory(mfs, filename) && (!foundMain || path_1.default.extname(filename) === '')) {
				resolvedPath = resolveImplicitExtension(mfs, path_1.default.join(filename, 'index'));
			} else {
				resolvedPath = resolveImplicitExtension(mfs, filename);
			}

			if (!resolvedPath) {
				throw new Error(`Cannot find module '${modulePath}, fs-require'`);
			}
			filename = resolvedPath.filePath;
    
      return filename;
    }

		const require = (modulePath) => {
			let _a; let _b;
			if (!utils_1.isFilePathPattern.test(modulePath)) {
				const [moduleName, moduleSubpath] = (_a = utils_1.getBareSpecifier(modulePath)) !== null && _a !== void 0 ? _a : [];
				if (moduleName === 'fs') {
					if (moduleSubpath) {
						throw new Error(`Cannot find module '${modulePath}'`);
					}
					return mocked['fs'];
				} else if (moduleName == 'events' || moduleName == 'internal/errors') {
					return realRequire(moduleName);
				} else if (builtins.includes(moduleName)) {
					return realRequire(moduleName);
				} else if (moduleName in (mocked || {})) {
					return mocked[moduleName];
				}
			}
			
      const filename = resolve(modulePath);

      const pathExtension = path_1.default.extname(filename);

			if (moduleCache.has(filename)) {
				return moduleCache.get(filename).exports;
			}

			const newModule = new module_1.default(filename, parentModule);
			newModule.filename = filename;
			moduleCache.set(filename, newModule);
			const sourceCode = mfs.readFileSync(filename).toString();
			loaders[pathExtension](newModule, sourceCode, makeRequireFunction, filename, fsRequireId);
			return newModule.exports;
		};
		require.id = fsRequireId;
    require.resolve = resolve;
		return require;
	}
	// @ts-expect-error parent is deprecated
	return makeRequireFunction(module.parent);
};
exports.createPatchedRequire = createPatchedRequire;
