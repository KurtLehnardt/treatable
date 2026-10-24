/** Import first in every bundle entry that reaches zod. zod probes `new Function("")` when its first object schema is
 * defined; under the extension CSP that probe throws (caught) yet still logs a CSP violation on chrome://extensions.
 * jitless skips the probe and the eval fast path; parsing behavior is unchanged. ES module evaluation order runs this
 * before any schema module, because each entry imports it ahead of everything else. */
import {z} from 'zod';
z.config({jitless:true});
