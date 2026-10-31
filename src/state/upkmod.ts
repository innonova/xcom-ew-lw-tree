// .upkmod files in the Tools page (features/upkit-source-mods.md): mods as
// source diffs, compiled by upkit when they are checked or applied. upkit's
// compiler is loaded only when one of the scripts is a .upkmod, and given the
// game's script packages it reads types from (read here first: the compiler
// reads them as it needs them, at once).

import { isUpkmod, type RunOptions } from '@innonova/upkit/modpatch'

/** The game's script packages, which a class's code names types from. */
const SCRIPT_PACKAGES = ['Core', 'Engine', 'GameFramework', 'GFxUI', 'IpDrv', 'OnlineSubsystemSteamworks', 'XComGame', 'XComStrategyGame', 'XComShell']

/**
 * What runs the .upkmod scripts among these, or undefined if none is one:
 * upkit's runner, with the script packages as `read` gives them (by file name,
 * "Core.upk"; null if the install has none).
 */
export async function upkmodRunnerFor(
  texts: string[],
  read: (file: string) => Promise<Uint8Array | null>,
): Promise<RunOptions['upkmod']> {
  if (!texts.some(isUpkmod)) return undefined
  const { upkmodRunner } = await import('@innonova/upkit/upkmodrun')
  const bytes = new Map<string, Uint8Array>()
  for (const n of SCRIPT_PACKAGES) {
    const b = await read(`${n}.upk`)
    if (b) bytes.set(`${n}.upk`.toLowerCase(), b)
  }
  return upkmodRunner((file) => bytes.get(file.toLowerCase()))
}
