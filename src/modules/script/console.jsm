/**
 * @fileoverview Implementation of userscript API console.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["ScriptApiConsole"];


/**
 * Construct a new Console object.
 * @constructor
 * @param api    Parent script API.
 *
 * @class   Dummy implementation of the Firebug console in order to prevent
 * scripts from breaking when Firebug is not installed. Messages are logged
 * in the JS console.
 */
ScriptApiConsole = function(/**ScriptApi*/ api) {
  /**
   * Log a message to the JS console.<br>
   * Accepts additional arguments that will be logged on individual lines.
   * @param aMessage    The message to log.
   */
  this.log = function(/**string*/ aMessage) {
    api.GM_log( Array.prototype.slice.apply(arguments).join("\n") );
  };
}

ScriptApiConsole.prototype = {
  /**
   * Never break on other Firebug.Console API calls.
   */
  __noSuchMethod__: function() {}
};

