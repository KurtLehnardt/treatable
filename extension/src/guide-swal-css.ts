/**
 * The build replaces this module with the packaged sweetalert2 stylesheet text (see scripts/build.mjs).
 * Outside a build, for example under the unit tests, it is empty and callers pass their own text.
 */
const SWEETALERT2_CSS: string = '';
export default SWEETALERT2_CSS;
