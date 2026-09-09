import { ASEPRITE_EXTENSION_STORAGE_KEY, ASEPRITE_EXTENSION_LIMITS, readAsepriteExtension } from './aseprite-extensions.mjs';

export function packagePreferenceKey(id) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(id)) throw Error('The package identity is invalid.');
  return `aseprite-package-preferences:${id}`;
}

/** Read source, package state and preferences from one durable snapshot. */
export async function capturePackageRun(store, {packageId, contributionId}) {
  const preferenceKey = packagePreferenceKey(packageId);
  const [registry, preferences] = await store.getSettingsSnapshot([ASEPRITE_EXTENSION_STORAGE_KEY, preferenceKey]);
  if (registry.value?.version !== 1 || !Array.isArray(registry.value.packages) || registry.value.packages.length > ASEPRITE_EXTENSION_LIMITS.packages) throw Error('The saved package registry is unavailable or invalid.');
  const matches = registry.value.packages.filter(entry => entry.id === packageId);
  if (matches.length !== 1 || matches[0].enabled !== true) throw Error('Enable the installed package before running its commands.');
  const entry = matches[0], pkg = readAsepriteExtension(entry.archive);
  if (pkg.id !== packageId || pkg.expandedBytes !== entry.expandedBytes) throw Error('The installed package no longer matches its saved entry.');
  const script = pkg.contributions.find(item => item.kind === 'scripts' && item.id === contributionId && item.status === 'source-ready');
  if (!script) throw Error('This package script is no longer available.');
  if (preferences.exists && (preferences.value?.version !== 1 || preferences.value.packageId !== packageId || !Object.hasOwn(preferences.value, 'preferences'))) throw Error('The saved package preferences are invalid.');
  return {
    packageId, contributionId, source:script.source,
    plugin:{name:pkg.name,displayName:pkg.displayName,version:pkg.version,preferences:preferences.exists ? preferences.value.preferences : {}},
    guards:[{key:registry.key,expectedRevision:registry.revision},{key:preferences.key,expectedRevision:preferences.revision}],
  };
}

/** Used with saveDocuments so package replacement cannot publish stale results. */
export function packageRunSettings(captured, result) {
  if (!result || result.name !== captured.plugin.name || result.version !== captured.plugin.version || typeof result.preferencesChanged !== 'boolean') throw Error('The package command returned an invalid identity.');
  return captured.guards.map(guard => guard.key === packagePreferenceKey(captured.packageId) && result.preferencesChanged ? {
    ...guard, value:{version:1,packageId:captured.packageId,preferences:structuredClone(result.preferences)},
  } : {...guard});
}

export async function assertPackageRunCurrent(store, captured) {
  const snapshots = await store.getSettingsSnapshot(captured.guards.map(guard => guard.key));
  if (snapshots.some((snapshot,index) => snapshot.revision !== captured.guards[index].expectedRevision)) throw Error('The package or its preferences changed while the command was running. Run it again.');
}
