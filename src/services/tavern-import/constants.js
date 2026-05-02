/**
 * @file src/services/tavern-import/constants.js
 * @description Shared limits and constants for Tavern card import.
 */

'use strict';

const MAX_IMPORT_FILES = 30;
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TEXT_FIELD = 20000;
const PREVIEW_TTL_MS = 24 * 60 * 60 * 1000;

module.exports = {
  MAX_IMPORT_FILES,
  MAX_IMPORT_FILE_BYTES,
  MAX_TEXT_FIELD,
  PREVIEW_TTL_MS,
};
