/* global __YTAF_BUILD_INFO__ */
export const buildInfo = Object.freeze(__YTAF_BUILD_INFO__);
window.__ytafBuildInfo = buildInfo;

export function buildLabel() {
  return `${buildInfo.version} · ${buildInfo.commit} · ${buildInfo.variant}${buildInfo.dirty ? ' · local changes' : ''}${buildInfo.instrumentation === 'perf' ? ' · perf' : ''}`;
}
