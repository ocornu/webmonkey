/**
 * @fileoverview Implementation of userscript @require dependency.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["ScriptRequire"];


const Cu = Components.utils;

// import dependencies
Cu.import("resource://webmonkey/lib/file.jsm");


/**
 * Construct a new require object.
 * @constructor
 * @param script    Parent script.
 * @param [node]    XML node from config file.
 *
 * @class   Implementation of some <code>&#64;require</code> functionalities.
 */
ScriptRequire = function(/**Script*/ script, /**nsIDOMNode*/ node) {
  /**
   * The parent script.
   * @type Script
   * @private
   */
  this._script = script;

  /**
   * URL to download this <code>&#64;require</code> from.
   * @type string
   * @private
   */
  this._downloadURL = null; // Only for scripts not installed
  /**
   * <code>&#64;require</code> file name (storage in {@link Script#_directory}).
   * @type string
   * @private
   */
  this._filename = null;

  if (node)
    this._fromXml(node);
};

ScriptRequire.prototype = {
  DEFAULT_FILENAME: "require.js",
  
  /**
   * Source file.
   * @type File
   */
  get file() {
    var file = new File(this._script._directory);
    file.name = this._filename;
    return file;
  },

  _fromXml: function(/**nsIDOMNode*/ node) {
    this._filename = node.getAttribute("filename");
  },
  
  toXml: function(/**nsIDOMNode*/ node) {
    node.setAttribute("filename", this._filename);
  },

  parse: function(/**string*/ value, /**nsIURI*/ baseUri) {
    this._downloadURL = File.getUri(value, baseUri).spec;
  },

  /**
   * Fetch this dependency file. Called internally by {@link Script#fetchDeps}.
   * @param onSuccess   The function to call back on success.
   * @param onError     The function to call back on error.
   * @param deps      The list of dependencies yet to fetch.
   */
  fetch: function(/**Function*/ onSuccess, /**Function*/ onError,
                  /**boolean*/deps) {
    var uri = this._validateUri();
    if (!uri) return onError(this, -1, "SecurityException: " +
                             "Request to local URI is forbidden");
    // create dependency file
    var file = new File(this._script._directory);
    file.name = toFilename(uri, this.DEFAULT_FILENAME);
    this._filename = file.createUnique();
    // fetch it
    var script = this._script;
    var dep = this;
    file.load(uri, function(channel, status, statusText) {
      if (status)
        return onError(dep, status, statusText);
      this._mimeType = channel.contentType;
      this._charset  = channel.contentCharset;
      script.fetchDeps(onSuccess, onError, deps);
    });
  },

  /**
   * Validate this dependency URI.<br>
   * Remote originating scripts cannot include local dependencies.
   * @return {nsIURI}
   */
  _validateUri: function() {
    var uri = File.getUri(this._downloadURL);
    switch (uri.scheme) {
    case "http":
    case "https":
    case "ftp":
      return uri;
    case "file":
      if (File.getUri(this._script._downloadURL).scheme == "file")
        return uri;
    default:
      return false;
    }
  }
};


/**
 * Transform a script name or a URI into a file name.<br>
 * A set of spaces/tabs becomes an underscore, non-Latin chars are removed.
 * Latin letters are lower-cased. Numbers, dots and minus sign are allowed. 
 * @param aOrigin               What to transform.
 * @param [aDefault="noname"]   Default value, in case of empty string.
 * @return {string}             A file name.
 * @private
 */
function toFilename(/**string|nsIURI*/ aOrigin, /**string*/ aDefault) {
  var name = aOrigin;
  if (typeof aOrigin != "string") {
    name = aOrigin.path;
    name = name.replace(/^.*\/([^/]*)$/, "$1").replace(/^([^?]*)\?.*$/, "$1");
  }
  name = name.toLowerCase().replace(/\s+/g, "_").replace(/[^-_A-Z0-9.]+/gi, "");
  // If no Latin characters found - use default
  if (name.length == 0) name = aDefault ? aDefault : "noname";
  return name;
};

