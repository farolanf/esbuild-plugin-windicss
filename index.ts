import { parse, ParserOptions } from '@babel/parser'
import type { OnLoadArgs, OnLoadResult, Plugin, PluginBuild, Loader } from 'esbuild'
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
  readonly pathBase?: string
  readonly babelParserOptions?: ParserOptions
  readonly windiCssConfig?: ConstructorParameters<typeof WindiCss>[0]
}

interface EsbuildPluginWindiCss {
  (options?: EsbuildPluginWindiCssOptions): EsbuildPipeablePlugin
  default: EsbuildPluginWindiCss
}

const pluginName = 'esbuild-plugin-windicss'

const ignoredClassPattern = RegExp(`\\b(${Object.getOwnPropertyNames(Object.prototype).join('|')})\\b`, 'g')

const plugin: EsbuildPluginWindiCss = ({ filter, pathBase, babelParserOptions, windiCssConfig } = {}) => {
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
  const cssFileContentsMap = new Map<string, string>()
  const transform = ({ args, contents }: EsbuildPipeableTransformArgs, build: PluginBuild): OnLoadResult => {
    // recreate WindiCss instance for each build
    if (firstFilePath === undefined) {
      firstFilePath = args.path
    } else if (firstFilePath === args.path) {
      windiCss = new WindiCss(windiCssConfig)
    }

    const styleSheet = new StyleSheet()
    for (const token of parse(contents, resolvedBabelParserOptions).tokens!) {
      if (token.value && (token.type.label === 'string' || token.type.label === 'template')) {
        const interpreted = windiCss.interpret(token.value.replace(ignoredClassPattern, ' ').trim(), true)
        if (interpreted.success.length !== 0) {
          styleSheet.extend(interpreted.styleSheet)
        }
      }
    }
    if (styleSheet.children.length !== 0) {
      const cssFilename = `${args.path}.${pluginName}.css`.replace(pathBase || '', '')
      cssFileContentsMap.set(cssFilename, styleSheet.combine().sort().build(true))
      contents = `import '${cssFilename}'\n${contents}`
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
      build.onResolve({ filter: RegExp(String.raw`\.${pluginName}\.css`) }, ({ path }) => ({ path, namespace: pluginName }))
      build.onLoad({ filter: RegExp(String.raw`\.${pluginName}\.css`), namespace: pluginName }, ({ path }) => {
        const contents = cssFileContentsMap.get(path)
        return contents ? { contents, loader: 'css' } : undefined
      })
    }) as EsbuildPipeablePlugin['setup'],
  }
}

export = plugin.default = plugin
