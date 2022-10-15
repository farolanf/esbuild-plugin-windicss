"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const parser_1 = require("@babel/parser");
const crypto_1 = __importDefault(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const windicss_1 = __importDefault(require("windicss"));
const style_1 = require("windicss/utils/style");
const pluginName = 'esbuild-plugin-windicss';
const ignoredClassPattern = RegExp(`\\b(${Object.getOwnPropertyNames(Object.prototype).join('|')})\\b`, 'g');
const plugin = ({ filter, babelParserOptions, windiCssConfig } = {}) => {
    const resolvedBabelParserOptions = babelParserOptions ? { ...babelParserOptions, tokens: true } : {
        errorRecovery: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowReturnOutsideFunction: true,
        allowSuperOutsideMethod: true,
        allowUndeclaredExports: true,
        tokens: true,
        plugins: ['jsx', 'typescript', 'topLevelAwait'],
    };
    let windiCss = new windicss_1.default(windiCssConfig);
    let firstFilePath;
    const styleSheet = new style_1.StyleSheet();
    const transform = ({ args, contents }, build) => {
        // recreate WindiCss instance for each build
        if (firstFilePath === undefined) {
            firstFilePath = args.path;
        }
        else if (firstFilePath === args.path) {
            windiCss = new windicss_1.default(windiCssConfig);
        }
        for (const token of parser_1.parse(contents, resolvedBabelParserOptions).tokens) {
            if (token.value && (token.type.label === 'string' || token.type.label === 'template')) {
                const interpreted = windiCss.interpret(token.value.replace(ignoredClassPattern, ' ').trim(), true);
                if (interpreted.success.length !== 0) {
                    styleSheet.extend(interpreted.styleSheet);
                }
            }
        }
        const ext = path.extname(args.path);
        const loader = build.initialOptions.loader?.[ext] || ext.slice(1);
        return { contents, loader: loader };
    };
    return {
        name: pluginName,
        setup: ((build, pipe) => {
            if (pipe?.transform) {
                return transform(pipe.transform, build);
            }
            build.onLoad({ filter: filter ?? /\.[jt]sx?$/ }, async (args) => {
                try {
                    return transform({ args, contents: await fs.promises.readFile(args.path, 'utf8') }, build);
                }
                catch (error) {
                    return { errors: [{ text: error.message }] };
                }
            });
            build.onEnd(async (result) => {
                if (!result.metafile)
                    return;
                const contents = styleSheet.combine().sort().build(true);
                const hash = crypto_1.default.createHash('md5').update(contents).digest('hex').slice(0, 8);
                const fileName = `${build.initialOptions.outdir}/css/windi-${hash.toUpperCase()}.css`;
                await fs.promises.mkdir(`${build.initialOptions.outdir}/css`, { recursive: true }).catch();
                await fs.promises.writeFile(fileName, contents);
                result.metafile.outputs[fileName] = {
                    imports: [],
                    exports: [],
                    inputs: {},
                    bytes: 0,
                };
            });
        }),
    };
};
module.exports = plugin.default = plugin;
