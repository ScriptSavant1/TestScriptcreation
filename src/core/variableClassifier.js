'use strict';

/**
 * Variable classification — the 7-rule system shared by ALL generators.
 *
 * This is the SINGLE SOURCE OF TRUTH for deciding which variables are:
 *   Tier 1 — Dynamic  (load.global / LR parameter, set at runtime by scripts/correlation)
 *   Tier 2 — Config   (parameterized, nextValue: once  — URLs, API keys, client IDs)
 *   Tier 3 — TestData (parameterized, nextValue: iteration — username, password, email)
 *
 * WHY a shared module:
 *   advancedScriptGenerator (DevWeb) and webHttpScriptGenerator (VuGen) previously each
 *   had a full copy of this logic. Any rule change had to be applied twice, and they
 *   silently diverged. The web_reg_save_param bug (June 2026) was caused by the same
 *   kind of duplication. This module eliminates that class of bug for classification.
 *
 * Consumers:
 *   generators/advancedScriptGenerator.js   → DevWeb
 *   generators/webHttpScriptGenerator.js    → VuGen Web HTTP/HTML
 *
 * @see Docs/REARCHITECTURE-PLAN.md — Phase 2
 */

// ─── Shared patterns ──────────────────────────────────────────────────────────
// Exported so generators can reuse them in their format-specific parameter
// map building (e.g. nextValue: isCredential ? 'iteration' : 'once').

const CREDENTIAL_PATTERN =
  /^(username|password|user|email|account|credential|login|pwd|passwd|user_?name|user_?id|user_?email)$/i;

// PEM-encoded keys / crypto secrets — must NEVER appear in CSV/PRM files.
// Multi-line content with special chars breaks CSV parsing.
// Treated as Tier 1 Dynamic so they stay in load.global / LR params only.
const PRIVATE_KEY_PATTERN =
  /private.?key|signing.?key|secret.?key|rsa.?key|client.?secret|signing.?secret|jwt.?secret|pem.?key|key.?pem|pkcs|p12.?key/i;

// JKS keystore references use similar naming but are plain string values
// (file paths, passwords, aliases) — exclude them from PRIVATE_KEY_PATTERN.
const KEYSTORE_EXCLUSION_PATTERN =
  /keystore|key.?password|key.?alias|key.?id/i;

// ─── Username detection (for "same as" CSV linking) ───────────────────────────
const USERNAME_PARAM_PATTERN = /^(username|user|user_?name|email|login|account)$/i;

// ─── Main classification function ─────────────────────────────────────────────
/**
 * Classify all collection variables into dynamic vs parameterized Sets.
 *
 * @param {object}       opts
 * @param {Map<string,*>} opts.variableMap       All vars: name → value
 * @param {Array}         opts.correlations       Correlation objects [{ name, ... }]
 * @param {Set<string>}   opts.scriptSetVarNames  Vars set by scripts (pm.*.set, vars.put, etc.)
 * @param {Map}           opts.csvVarNames        JMX CSVDataSet columns: name → { fileName, ... }
 * @param {Set<string>}  [opts.envVarKeys]        Keys from environment files (DevWeb only).
 *                                                Pass empty Set (or omit) for VuGen — Rule 4
 *                                                will then treat ALL empty non-credential vars
 *                                                as dynamic, which is the VuGen behaviour.
 *
 * @returns {{ dynamicVarNames: Set<string>, paramVarNames: Set<string>, usernameParam: string|null }}
 *   dynamicVarNames  — Tier 1: set at runtime, need load.global / LR param with no CSV row
 *   paramVarNames    — Tier 2/3: static values to go into CSV/PRM files
 *   usernameParam    — first username-like param found (for "same as" linking in CSV)
 */
function classifyVariables({
  variableMap,
  correlations = [],
  scriptSetVarNames = new Set(),
  csvVarNames = new Map(),
  envVarKeys = new Set(),   // DevWeb: pass this.envVarKeys; VuGen: omit or pass new Set()
}) {
  const dynamicVarNames = new Set();
  const paramVarNames   = new Set();
  let   usernameParam   = null;

  // ── RULE 0 ────────────────────────────────────────────────────────────────
  // JMX CSVDataSet columns → always Tier 3 (nextValue: iteration).
  // These have empty values from injectCsvVariables() and would otherwise fall
  // into Rule 4 (dynamic) — this guard prevents that misclassification.
  for (const [col] of csvVarNames) {
    paramVarNames.add(col);
  }

  // ── RULE 1 ────────────────────────────────────────────────────────────────
  // Correlation targets → Tier 1 Dynamic.
  // Values extracted from API responses at runtime via web_reg_save_param* / extractors.
  for (const corr of correlations) {
    dynamicVarNames.add(corr.name);
  }

  // ── RULE 2 ────────────────────────────────────────────────────────────────
  // Script-set variables → Tier 1 Dynamic.
  // Any variable explicitly set by a script (pm.*.set, bru.setEnv, vars.put) is runtime.
  for (const name of scriptSetVarNames) {
    dynamicVarNames.add(name);
  }

  // ── RULE 2.5 ──────────────────────────────────────────────────────────────
  // Private key / cryptographic secret → Tier 1 Dynamic (if empty) or Tier 2 Config param.
  // PEM keys with actual content go to the parameter file (DevWeb: rts.yml userArguments /
  // VuGen: ParameterFile.prm) where newlines can be escaped. They must NOT be in CSV rows.
  for (const [name, value] of variableMap.entries()) {
    if (PRIVATE_KEY_PATTERN.test(name) && !KEYSTORE_EXCLUSION_PATTERN.test(name)) {
      const isEmpty = value === '' || value === null || value === undefined;
      if (isEmpty) {
        dynamicVarNames.add(name);   // empty PEM → runtime placeholder
      } else {
        paramVarNames.add(name);     // actual PEM → stored as a Once param
      }
    }
  }

  // ── RULE 3 ────────────────────────────────────────────────────────────────
  // Underscore prefix → Tier 1 Dynamic regardless of value.
  // Postman/Bruno convention: _ prefix = correlation placeholder that will be
  // populated at runtime.
  for (const [name] of variableMap.entries()) {
    if (name.startsWith('_')) dynamicVarNames.add(name);
  }

  // ── RULE 4 ────────────────────────────────────────────────────────────────
  // Empty value → Tier 1 Dynamic (safety net for unresolved runtime placeholders).
  // Static config vars (baseUrl, clientId, apiKey) ALWAYS have real values.
  // Runtime vars (access_token, refresh_token) are intentionally left empty because
  // they are filled from API responses. Credentials (username/password) are excluded.
  //
  // DevWeb exception: blank variables that came from an environment file are NOT
  // runtime-set vars — they are config placeholders the user fills in rts.yml.
  // Those go to paramVarNames (→ userArguments with empty value).
  // Pass envVarKeys=new Set() for VuGen to skip this branch entirely.
  for (const [name, value] of variableMap.entries()) {
    if (dynamicVarNames.has(name)) continue;
    if (paramVarNames.has(name))   continue;   // already a param (Rule 0 or 2.5)
    if (name.startsWith('$'))      continue;   // Postman builtins ($guid, $timestamp) — skip
    const isEmpty      = value === '' || value === null || value === undefined;
    const isCredential = CREDENTIAL_PATTERN.test(name);
    if (isEmpty && !isCredential) {
      if (envVarKeys.has(name)) {
        paramVarNames.add(name);     // blank env var → userArguments with empty value OK
      } else {
        dynamicVarNames.add(name);   // unresolved placeholder → load.global / LR param
      }
    }
  }

  // ── RULE 5 ────────────────────────────────────────────────────────────────
  // Everything else with a real value → Tier 2 Config or Tier 3 TestData param.
  // (Callers distinguish Tier 2 vs 3 via CREDENTIAL_PATTERN on isCredential ? iteration : once.)
  for (const [name] of variableMap.entries()) {
    if (dynamicVarNames.has(name)) continue;
    if (name.startsWith('$'))      continue;
    paramVarNames.add(name);

    // Track first username-like param for "same as" linking in the CSV/PRM file.
    // Only the first match is used — subsequent username-like vars link to it too.
    if (!usernameParam && USERNAME_PARAM_PATTERN.test(name)) {
      usernameParam = name;
    }
  }

  return { dynamicVarNames, paramVarNames, usernameParam };
}

module.exports = {
  classifyVariables,
  CREDENTIAL_PATTERN,
  PRIVATE_KEY_PATTERN,
  KEYSTORE_EXCLUSION_PATTERN,
  USERNAME_PARAM_PATTERN,
};
