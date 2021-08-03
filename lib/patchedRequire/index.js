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
	'internal/errors',
];

const BUILTIN_MODULES_SC = process.binding('natives');

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
	const moduleWrappedSourceCode = `
		(function(exports, require, module, __filename, __dirname, process) {
			${sourceCode}
		});
	`;
	// Reference: https://github.com/nodejs/node/blob/master/lib/internal/modules/cjs/loader.js#L1028
	vm_1.default.runInThisContext(moduleWrappedSourceCode, {
		filename: `fs-require://${id}${filename}`,
		lineOffset: 0,
		displayErrors: true,
	})(newModule.exports, makeRequire(newModule), newModule, path_1.default.basename(filename), path_1.default.dirname(filename), {
		...process,
		env: {
			...process.env,
			PWD: '/',
			OWD: '/',
		},
		cwd: function() { return '/'; },
	});
};
loaders['.js'] = loaders[''];
loaders['.json'] = function(newModule, sourceCode) {
	newModule.exports = JSON.parse(sourceCode);
};

function loadBuiltin(newModule, sourceCode, makeRequire) {
	const moduleWrappedSourceCode = `(function (exports, require, module, process, internalBinding) {
		'use strict';
		const primordials = global;
		${sourceCode}
		\n
	});`

	vm_1.default.runInThisContext(moduleWrappedSourceCode, {
		filename: `path.vm.js`,
		lineOffset: 0,
		displayErrors: true,
	})(newModule.exports, makeRequire(newModule), newModule, {
		...process,
		env: {
			...process.env,
			PWD: '/',
			OWD: '/',
		},
		cwd: function() { return '/'; },
	}, process.binding);
}

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
	if (!dirPath) return;
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
					
					const newFS = {default: {}};

					for (const key in mocked.fs) {
						if (typeof mocked.fs[key] === 'function') {
							newFS[key] = (...args) => mocked.fs[key](...args);
							newFS.default[key] = (...args) => mocked.fs[key](...args);
						} else {
							newFS[key] = mocked.fs[key];
							newFS.default[key] = mocked.fs[key];
						}
					}

					Object.setPrototypeOf(newFS, Object.getPrototypeOf(mocked.fs) || null);
					Object.setPrototypeOf(newFS.default, Object.getPrototypeOf(mocked.fs) || null);

					for (const key in mocked.fs) {
						if (typeof mocked.fs[key] === 'object' || typeof mocked.fs[key] === 'function') {
							Object.setPrototypeOf(newFS[key], Object.getPrototypeOf(mocked.fs[key]) || null);
						}
					}

					for (const key in mocked.fs.default) {
						if (typeof mocked.fs.default[key] === 'object' || typeof mocked.fs.default[key] === 'function') {
							Object.setPrototypeOf(newFS.default[key], Object.getPrototypeOf(mocked.fs.default[key]) || null);
						}
					}

					return newFS;
				} else if (moduleName == 'events' || moduleName == 'internal/errors') {
					return realRequire(moduleName);
				} else if (moduleName in (mocked || {})) {
					return mocked[moduleName];
				} else if (moduleName == 'path') {
					const newPath = {
						...path_1.default,
						resolve: (...args) => {
							const resolvedPath = path_1.default.resolve('/', ...args);
							return resolvedPath;
						},
						default: {
							...path_1.default,
							resolve: (...args) => {
								const resolvedPath = path_1.default.resolve('/', ...args);
								return resolvedPath;
							}
						},
					};

					Object.setPrototypeOf(newPath, Object.getPrototypeOf(path_1) || null);
					Object.setPrototypeOf(newPath.default, Object.getPrototypeOf(path_1.default) || null);

					// set prototype of all subobjects
					for (const key in newPath) {
						if (typeof newPath[key] === 'object' || typeof newPath[key] === 'function') {
							Object.setPrototypeOf(newPath[key], Object.getPrototypeOf(newPath) || null);
						}
					}

					return newPath;
				} else if (builtins.includes(moduleName)) {
					return realRequire(moduleName);
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
	return makeRequireFunction({ filename: '/' });
};
exports.createPatchedRequire = createPatchedRequire;