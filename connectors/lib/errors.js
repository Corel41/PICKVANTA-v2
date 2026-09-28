'use strict';

/**
 * The four failures the runner distinguishes, and what each one means for an
 * exit code. A run that ends in any of these says why; none of them is ever
 * swallowed into a "success" line.
 *
 * Exit codes (also documented in connectors/README.md):
 *   0  the run completed and every record was valid
 *   1  the run completed and at least one record was rejected, or the same
 *      product id appeared twice in one batch (a data problem, not a crash)
 *   2  the run could not complete (usage, source, transport, response or
 *      environment failure), or it asked for something this build refuses
 *      to do
 */

const EXIT_OK = 0;
const EXIT_DATA = 1;
const EXIT_FAILED = 2;

class ConnectorError extends Error {
  constructor(kind, message, detail) {
    super(message);
    this.name = this.constructor.name;
    this.kind = kind;
    this.detail = detail || null;
    this.exitCode = EXIT_FAILED;
  }
}

/** The command line asked for something the runner cannot do. */
class UsageError extends ConnectorError {}

/** The runner's environment is not ready (a missing or wrong secret). */
class EnvironmentError extends ConnectorError {}

/** The source row/fixture is missing, paused or unreadable. */
class SourceError extends ConnectorError {}

/** The transport could not obtain a response: timeout, HTTP status, unreadable. */
class TransportError extends ConnectorError {}

/** A response arrived but this adapter cannot read it. */
class AdapterError extends ConnectorError {}

module.exports = {
  EXIT_OK,
  EXIT_DATA,
  EXIT_FAILED,
  ConnectorError,
  UsageError,
  EnvironmentError,
  SourceError,
  TransportError,
  AdapterError
};
