/**
 * @fileoverview Implementation of a user-script.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["Script"];


const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// import dependencies
Cu.import("resource://webmonkey/script/metadata.jsm");
Cu.import("resource://webmonkey/script/api.jsm");
Cu.import("resource://webmonkey/lib/file.jsm");
Cu.import("resource://webmonkey/lib/prefs.jsm");
Cc["@mozilla.org/moz/jssubscript-loader;1"]
  .getService(Ci.mozIJSSubScriptLoader)
  .loadSubScript("resource://webmonkey/lib/convert2RegExp.js");


/**
 * Construct a new script object (private use only).<br>
 * This constructor should not be used directly, use the static factory methods
 * instead.
 * @constructor
 *
 * @class   Implementation of a script.<br>
 *          Provides place-holders for its configuration and status, as well as
 *          facilities to manage its presence in the filesystem.
 */
function Script() {
  /**
   * Associated Webmonkey configuration manager.
   * @type Config
   * @private
   */
  this._config = null;
  /**
   * Script meta-data.
   * @type ScriptMetadata
   */
  this.meta = new ScriptMetadata(this);
  /**
   * Registered handlers for events originating from this script.
   * @type Array
   * @private
   */
  this._observers = [];

  /**
   * URL to download this script from.
   * @type string
   * @private
   */
  this._downloadURL = null;
  /**
   * Script file name in its {@link #_directory}.
   * @type string
   * @private
   */
  this._filename = null;
  /**
   * Script directory.
   * @type File
   * @private
   */
  this._directory = null;
}

Script.prototype = {
  /**
   * Whether this script may run at a specified URL.
   * <code>url</code> is checked against the script sets of includes/excludes.
   * @param url         The URL to test.
   * @return {boolean}  <code>true</code> if this script can run,
   *                    <code>false</code> otherwise.
   */
  isRunnable: function(/**string*/ url) {
    return this.meta.includes.some(match) && !this.meta.excludes.some(match);

    function match(rule) {
      return convert2RegExp(rule).test(url);
    }
  },

  /**
   * Notify observers of a change in this script's configuration.
   * @param event  A label defining what has changed.
   * @param data   An associated payload.
   * @private
   */
  _changed: function(/**string*/ event, /**Object*/ data) {
     this._config._changed(this, event, data);
  },

  /**
   * This script source file.
   * @type File
   */
  get file() {
    var file = new File(this._directory);
    file.name = this._filename;
    return file;
  },

  /**
   * Edit this script source code.
   * @param aParentWindow  The parent window (in case editor picking is needed).
   */
  edit: function(/**nsIDOMWindow*/ aParentWindow) {
    var editor = this._config.getEditor(aParentWindow);
    if (!editor) return;
    editor.exec([this.file.path]);
  },

  /**
   * Install this script in the specified {@link Config}.<br>
   * Moves its directory from the temp folder to the scripts folder.
   * @param aConfig  Associated Webmonkey configuration manager.
   */
  install: function(/**Config*/ aConfig) {
    this._config = aConfig;
    var dir = new File(aConfig._scriptDir);
    dir.name = this._filename.replace(/\.user\.js$/, "");
    dir.createUnique(File.DIR);
    dir.remove(true);
    // create script file
    this._directory.moveTo(dir._nsIFile.parent, dir.name);
    this._directory = dir;
  },

  /**
   * Inject this script into a DOM window/frame.
   * @param unsafeWin   Target window.
   * @param gmBrowser   <code>GM_BrowserUI</code> responsible for this window.
   * @param [console]   Firebug console, if any.
   */
  inject: function(/**nsIDOMWindow*/    unsafeWin,
                   /**GM_BrowserUI*/    gmBrowser,
                   /**Firebug.Console*/ console) {
    if (!this._api)
      this._api = new ScriptApi(this);
    var sandbox = this._api.sandbox(unsafeWin, gmBrowser, console); 
    var jsVersion = "1.6";
    // @requires source files
    for each(var require in this.meta.requires)
      this._inject(require, sandbox, jsVersion);
    // script source file
    this._inject(this, sandbox, jsVersion);
  },

  _inject: function(/**Script|ScriptRequire*/    source,
                    /**Components.utils.Sandbox*/ sandbox,
                    /**string*/                   jsVersion) {
    var file = source.file;
    try {
      Cu.evalInSandbox(file.readText(), sandbox, jsVersion, file.uri.spec, 1);
    } catch (err) {
      this._api.logError(new Error(err.message, file.uri.spec, err.lineNumber));
    }
  },

  _fromXml: function(/**nsIDOMNode*/ node, /**File*/ dir) {
    this._directory = new File(dir);
    this._directory.name = node.getAttribute("basedir");
    this._filename = node.getAttribute("filename");
    this.meta.fromXml(node);
  },

  /**
   * @return {nsIDOMNode}
   */
  toXml: function(/**nsIDOMDocument*/ doc) {
    var node = doc.createElement("Script");
    node.setAttribute("basedir", this._directory.name);
    node.setAttribute("filename", this._filename);
    this.meta.toXml(doc, node);
    node.appendChild(doc.createTextNode("\n\t"));
    return node;
  },

  _parse: function(source, uri) {
    this._downloadURL = uri ? uri.spec : null;
    this.meta.parse(source, uri);
  },

  /**
   * Fetch this script dependencies.<br>
   * Do not set the <code>deps</code> parameter: it is used internally to track
   * remaining dependencies as <code>fetchDeps</code> is recursively called.
   * @param onSuccess   The function to call back on success.
   * @param onError     The function to call back on error.
   * @param [deps]      The list of dependencies yet to fetch (internal only).
   */
  fetchDeps: function(/**Function*/ onSuccess,
                      /**Function*/ onError,
                      /**boolean*/  deps) {
    if (deps == undefined)
      deps = this.meta.requires.concat(this.meta.resources);
    if (deps.length == 0)
      onSuccess(this);
    else
      deps.shift().fetch(onSuccess, onError, deps);
  }
};


/**
 * Factory method to create a new {@link Script} instance from its source code.
 * @param aSource   The script source code.
 * @param [aUri]    The script's original URI.
 * @return {Script}
 */
Script.fromSource = function(/**string*/ aSource, /**nsIURI*/ aUri) {
  var script = new Script();
  script._parse(aSource, aUri);
  // create temp script dir (max name length: 24)
  var name = toFilename(script.meta.name, "script");
  if (name.length > 24) name = name.substring(0, 24);
  script._directory = File.temp();
  script._directory.name = name;
  script._directory.createUnique(File.DIR);
  // create script file
  script._filename = name + ".user.js";
  var file = script.file;
  file.create();
  file.write(aSource);
  return script;
};

/**
 * Factory method to create a new {@link Script} instance from its stored config.
 * @param aConfig   The Webmonkey configuration.
 * @param aNode     This script config XML node.
 * @return {Script}
 */
Script.fromConfig = function(/**Config*/ aConfig, /**nsiDOMNode*/ aNode) {
  var script = new Script();
  script._config = aConfig;
  script._fromXml(aNode, aConfig._scriptDir);
  return script;
};

/**
 * Factory method to create a new {@link Script} instance from a URI.
 * @param aUri      The script's original URI.
 * @param onSuccess The function to call back on success.
 * @param onError   The function to call back on error.
 * @param [noDeps]  If <code>true</code>, do not fetch dependencies.
 */
Script.fromUri = function(/**nsIURI*/   aUri,
                          /**Function*/ onSuccess,
                          /**Function*/ onError,
                          /**boolean*/  noDeps) {
  var file = File.temp();
  file.name = "script";
  file.createUnique();
  file.load(aUri, function(channel, status, statusText) {
    if (status)
      return onError(null, status, statusText);
    var script = Script.fromSource(file.readText(), aUri);
    file.remove();
    if (noDeps) return onSuccess(script);
    script.fetchDeps(onSuccess, onError);
  });
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

