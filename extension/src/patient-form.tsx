/** Health and free-text fields: no autofill storage, no (Enhanced) spellcheck upload, no autocorrect, no password-manager capture. */
export const PRIVATE_TEXT_FIELD={autoComplete:'off',spellCheck:false,autoCorrect:'off',autoCapitalize:'off','data-1p-ignore':'true','data-lpignore':'true'} as const;
