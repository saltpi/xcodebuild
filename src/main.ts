import {
  getBooleanInput,
  getInput,
  info,
  setFailed,
  setOutput
} from '@actions/core'
import {exec} from '@actions/exec'
import {existsSync, mkdirSync, rmSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'
import {
  buildExportArgs,
  buildPipeline,
  buildXcodebuildArgs,
  defaultLogPath,
  findExportArtifacts,
  shellQuote,
  validateInputs
} from './xcodebuild'

async function run(): Promise<void> {
  try {
    const workspace = getInput('workspace')
    const project = getInput('project')
    const scheme = getInput('scheme', {required: true})
    const configuration = getInput('configuration') || 'Release'
    const sdk = getInput('sdk')
    const destination = getInput('destination')
    const xcAction = getInput('action') || 'build'
    const archivePathInput = getInput('archive-path')
    const exportOptionsPlist = getInput('export-options-plist')
    const exportPathInput = getInput('export-path')
    const derivedDataPath =
      getInput('derived-data-path') || '.build/DerivedData'
    const resultBundlePathInput = getInput('result-bundle-path')
    const buildNumber = getInput('build-number')
    const buildSettingsInput = getInput('build-settings')
    const extraArguments = getInput('extra-arguments')
    const exportExtraArguments = getInput('export-extra-arguments')
    const allowProvisioningUpdates = getBooleanInput(
      'allow-provisioning-updates'
    )
    const allowProvisioningDeviceRegistration = getBooleanInput(
      'allow-provisioning-device-registration'
    )
    const rawAuthKeyPath = getInput('authentication-key-path')
    const authenticationKeyId = getInput('authentication-key-id')
    const authenticationKeyIssuerId = getInput('authentication-key-issuer-id')
    const outputFormatter = getInput('output-formatter')
    const logPathInput = getInput('log-path')
    const parallelizeTargets = getBooleanInput('parallelize-targets')
    const showTimingSummary = getBooleanInput('show-build-timing-summary')
    const disableAutoPackageResolution = getBooleanInput(
      'disable-automatic-package-resolution'
    )
    const zipResultBundle = getBooleanInput('zip-result-bundle')
    const zipArchive = getBooleanInput('zip-archive')
    const workingDirectoryInput = getInput('working-directory')

    const exportOnly = xcAction === 'export'
    const cwd = workingDirectoryInput
      ? resolve(workingDirectoryInput)
      : process.cwd()

    const authenticationKeyPath = rawAuthKeyPath
      ? resolve(cwd, rawAuthKeyPath)
      : ''

    validateInputs({
      workspace,
      project,
      xcAction,
      archivePath: archivePathInput,
      exportOptionsPlist,
      cwd,
      authenticationKeyPath,
      authenticationKeyId,
      authenticationKeyIssuerId
    })

    const resultBundlePath =
      resultBundlePathInput || join('.build', 'Artifacts', `${scheme}.xcresult`)
    const logPath = logPathInput || defaultLogPath(scheme, xcAction)
    const archivePath = archivePathInput || ''

    const resultBundleAbs = resolve(cwd, resultBundlePath)
    mkdirSync(dirname(resolve(cwd, logPath)), {recursive: true})

    if (!exportOnly) {
      if (existsSync(resultBundleAbs)) {
        rmSync(resultBundleAbs, {recursive: true, force: true})
      }
      mkdirSync(dirname(resultBundleAbs), {recursive: true})

      const args = buildXcodebuildArgs({
        workspace,
        project,
        scheme,
        configuration,
        sdk,
        destination,
        parallelizeTargets,
        showTimingSummary,
        disableAutoPackageResolution,
        derivedDataPath,
        resultBundlePath,
        archivePath,
        buildNumber,
        buildSettings: buildSettingsInput,
        extraArguments,
        allowProvisioningUpdates,
        allowProvisioningDeviceRegistration,
        authenticationKeyPath,
        authenticationKeyId,
        authenticationKeyIssuerId,
        action: xcAction
      })

      await runXcodebuild(args, outputFormatter, logPath, cwd, false)
    }

    let exportPath = ''
    let ipaPath = ''
    let appPath = ''
    let pkgPath = ''
    if (exportOptionsPlist && archivePath) {
      exportPath =
        exportPathInput || join(dirname(resultBundlePath), `${scheme}.ipa`)
      mkdirSync(resolve(cwd, exportPath), {recursive: true})
      const exportArgs = buildExportArgs({
        exportOptionsPlist,
        archivePath,
        exportPath,
        allowProvisioningUpdates,
        allowProvisioningDeviceRegistration,
        authenticationKeyPath,
        authenticationKeyId,
        authenticationKeyIssuerId,
        exportExtraArguments,
        extraArguments
      })
      await runXcodebuild(exportArgs, outputFormatter, logPath, cwd, true)
      ;({ipaPath, appPath, pkgPath} = findExportArtifacts(exportPath, cwd))
    }

    if (!exportOnly && zipResultBundle && existsSync(resultBundleAbs)) {
      await ditto(resultBundleAbs, `${resultBundleAbs}.zip`, cwd)
    }
    if (zipArchive && archivePath) {
      const archiveAbs = resolve(cwd, archivePath)
      if (existsSync(archiveAbs)) {
        await ditto(archiveAbs, `${archiveAbs}.zip`, cwd)
      }
    }

    if (!exportOnly) setOutput('result-bundle-path', resultBundlePath)
    setOutput('log-path', logPath)
    if (archivePath) setOutput('archive-path', archivePath)
    if (exportPath) setOutput('export-path', exportPath)
    if (ipaPath) setOutput('ipa-path', ipaPath)
    if (appPath) setOutput('app-path', appPath)
    if (pkgPath) setOutput('pkg-path', pkgPath)
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message)
    } else {
      setFailed(`Action failed with error ${error}`)
    }
  }
}

async function runXcodebuild(
  args: string[],
  formatter: string,
  logPath: string,
  cwd: string,
  appendLog: boolean
): Promise<void> {
  const quoted = ['xcrun', 'xcodebuild', ...args].map(shellQuote).join(' ')
  info(`Running: ${quoted}`)
  await exec(
    'bash',
    ['-c', buildPipeline(args, formatter, logPath, appendLog)],
    {
      cwd
    }
  )
}

async function ditto(src: string, dest: string, cwd: string): Promise<void> {
  await exec(
    'ditto',
    ['-c', '-k', '--sequesterRsrc', '--keepParent', src, dest],
    {cwd}
  )
}

run()
