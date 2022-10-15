import { parse, ParserOptions } from '@babel/parser'
import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild, Loader } from 'esbuild'
import crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'
import WindiCss from 'windicss'
import { StyleSheet } from 'windicss/utils/style'

interface EsbuildPipeableTransformArgs {
  readonly args: OnLoadArgs
  readonly contents: string
}

interface EsbuildPipeablePlugin extends Plugin {
  setup(build: PluginBuild, pipe: { transform: EsbuildPipeableTransformArgs }): OnLoadResult
  setup(build: PluginBuild): void
}

interface EsbuildPluginWindiCssOptions {
  readonly filter?: RegExp
  readonly babelParserOptions?: ParserOptions
  readonly windiCssConfig?: ConstructorParameters<typeof WindiCss>[0]
}

interface EsbuildPluginWindiCss {
  (options?: EsbuildPluginWindiCssOptions): EsbuildPipeablePlugin
  default: EsbuildPluginWindiCss
}

const pluginName = 'esbuild-plugin-windicss'

const ignoredClassPattern = RegExp(`\\b(${Object.getOwnPropertyNames(Object.prototype).join('|')})\\b`, 'g')

const plugin: EsbuildPluginWindiCss = ({ filter, babelParserOptions, windiCssConfig } = {}) => {
  const resolvedBabelParserOptions: ParserOptions = babelParserOptions ? { ...babelParserOptions, tokens: true } : {
    errorRecovery: true,
    allowAwaitOutsideFunction: true,
    allowImportExportEverywhere: true,
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    allowUndeclaredExports: true,
    tokens: true,
    plugins: ['jsx', 'typescript', 'topLevelAwait'],
  }
  let windiCss = new WindiCss(windiCssConfig)
  let firstFilePath: string | undefined
  const styleSheet = new StyleSheet()
  const transform = ({ args, contents }: EsbuildPipeableTransformArgs, build: PluginBuild): OnLoadResult => {
    // recreate WindiCss instance for each build
    if (firstFilePath === undefined) {
      firstFilePath = args.path
    } else if (firstFilePath === args.path) {
      windiCss = new WindiCss(windiCssConfig)
    }
    for (const token of parse(contents, resolvedBabelParserOptions).tokens!) {
      if (token.value && (token.type.label === 'string' || token.type.label === 'template')) {
        const interpreted = windiCss.interpret(token.value.replace(ignoredClassPattern, ' ').trim(), true)
        if (interpreted.success.length !== 0) {
          styleSheet.extend(interpreted.styleSheet)
        }
      }
    }
    const ext = path.extname(args.path)
    const loader = build.initialOptions.loader?.[ext] || ext.slice(1)
    return { contents, loader: loader as Loader }
  }
  return {
    name: pluginName,
    setup: ((build: PluginBuild, pipe?: { transform: EsbuildPipeableTransformArgs }) => {
      if (pipe?.transform) {
        return transform(pipe.transform, build)
      }
      build.onLoad({ filter: filter ?? /\.[jt]sx?$/ }, async args => {
        try {
          return transform({ args, contents: await fs.promises.readFile(args.path, 'utf8') }, build)
        } catch (error) {
          return { errors: [{ text: (error as Error).message }] }
        }
      })
      build.onEnd(async result => {
        if (!result.metafile) return
        const contents = styleSheet.combine().sort().build(true)
        const hash = crypto.createHash('md5').update(contents).digest('hex').slice(0, 8)
        const fileName = `${build.initialOptions.outdir}/css/windi-${hash.toUpperCase()}.css`
        await fs.promises.mkdir(`${build.initialOptions.outdir}/css`, { recursive: true }).catch()
        await fs.promises.writeFile(fileName, contents)
        result.metafile!.outputs[fileName] = {
          imports: [],
          exports: [],
          inputs: {},
          bytes: 0,
        }
      })
    }) as EsbuildPipeablePlugin['setup'],
  }
}

export = plugin.default = plugin
