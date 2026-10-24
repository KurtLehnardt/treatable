/**
 * The guide imports the stylesheet-free ES module build of sweetalert2 so that nothing is injected into
 * the page head at import time. The package ships its types only for the bare specifier.
 */
declare module 'sweetalert2/dist/sweetalert2.esm.js' {
  import Swal from 'sweetalert2';
  export default Swal;
}
