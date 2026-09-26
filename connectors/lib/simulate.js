'use strict';

/**
 * The offline stand-in for the ingest outcomes migration 0011 will produce.
 *
 * The write path does not exist yet (it arrives in 17C-C), so a dry run cannot
 * ask the database what it would have done. This module answers the same
 * question in memory, with the same vocabulary:
 *
 *   imported   this identity has not been seen in this process before
 *   updated    it has been seen, and the evidence (raw) changed
 *   unchanged  it has been seen, and the evidence is byte-for-byte the same
 *   duplicate  the same identity appears more than once inside one payload.
 *              In 17C-C the later occurrence will update the earlier one
 *              through the unique index on (source_id, external_product_id)
 *              rather than creating a second row; a dry run reports it
 *              because a feed that lists one product twice is a data problem
 *              the operator should see before it reaches the database.
 *
 * Nothing is stored: the state lives in a Map for the length of the process and
 * is discarded when the runner exits. This is not a database write and nothing
 * here is sent anywhere.
 */

const { identityKey, hashRaw } = require('./contract');

function newState() {
  return new Map();
}

/**
 * @param {object} batch       the payload a connector produced
 * @param {object} run         { run_id } — one id per pass over the source
 * @param {object[]} validated per-record validation results, in record order
 * @param {Map} state          identities seen so far in this process
 * @returns {{outcomes: object[], summary: object}}
 */
function simulateBatch(batch, run, validated, state) {
  const outcomes = [];
  const summary = { imported: 0, updated: 0, unchanged: 0, duplicate: 0, rejected: 0 };

  validated.forEach((result, index) => {
    if (!result.ok) {
      summary.rejected += 1;
      outcomes.push({
        index: index,
        external_product_id: result.external_product_id,
        outcome: 'rejected',
        raw_hash: '',
        errors: result.errors
      });
      return;
    }

    const record = batch.records[index];
    const identity = identityKey(batch.source_id, record.external_product_id);
    const rawHash = hashRaw(record.raw);
    const seen = state.get(identity);

    let outcome;
    if (!seen) {
      outcome = 'imported';
    } else if (seen.run_id === run.run_id) {
      outcome = 'duplicate';
    } else if (seen.raw_hash === rawHash) {
      outcome = 'unchanged';
    } else {
      outcome = 'updated';
    }

    state.set(identity, { raw_hash: rawHash, run_id: run.run_id, index: index });

    summary[outcome] += 1;
    outcomes.push({
      index: index,
      external_product_id: record.external_product_id,
      outcome: outcome,
      raw_hash: rawHash,
      previous: seen ? { raw_hash: seen.raw_hash, run_id: seen.run_id } : null,
      errors: []
    });
  });

  return { outcomes: outcomes, summary: summary };
}

module.exports = { newState: newState, simulateBatch: simulateBatch };
