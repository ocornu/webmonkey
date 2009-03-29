/**
 * @fileoverview JS Module implementation of a script.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["Script", "ScriptRequire", "ScriptResource"];


Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                   .getService(Components.interfaces.mozIJSSubScriptLoader)
                   .loadSubScript("resource://webmonkey/utils/convert2RegExp.js");
Components.utils.import("resource://webmonkey/utils/file.js");


/**
 * Construct a new script object.
 * @constructor
 * @param {Config} config   Associated Webmonkey configuration.
 *
 * @class   Implementation of a script.<br>
 *          Provides place-holders for its configuration and status, as well as
 *          facilities to manage its presence in the filesystem.
 */
function Script(config) {
  /**
   * Associated Webmonkey configuration manager.
   * @type Config
   * @private
   */
  this._config = config;
  /**
   * Registered handlers for events originating from this script.
   * @type Array
   * @private
   */
  this._observers = [];

  /**
   * URL to download this script from.
   * @type String
   * @private
   */
  this._downloadURL = null; // Only for scripts not installed
  /**
   * Temporary file used during the installation process.
   * @type nsIFile
   * @private
   */
  this._tempFile = null; // Only for scripts not installed
  /**
   * Name of the directory holding this script file(s).
   * @type String
   * @private
   */
  this._basedir = null;
  /**
   * Script file name in {@link #_basedir}.
   * @type String
   * @private
   */
  this._filename = null;

  /**
   * Script <code>&#64;name</code>.
   * @type String
   * @private
   */
  this._name = null;
  /**
   * Script <code>&#64;namespace</code>.
   * @type String
   * @private
   */
  this._namespace = null;
  /**
   * Script <code>&#64;description</code>.
   * @type String
   * @private
   */
  this._description = null;

  /**
   * Enabled/disabled state.
   * @type Boolean
   * @private
   */
  this._enabled = true;
  /**
   * List of included URL masks.
   * @type Array
   * @private
   */
  this._includes = [];
  /**
   * List of excluded URL masks.
   * @type Array
   * @private
   */
  this._excludes = [];
  /**
   * List of <code>&#64;require</code> items.
   * @type Array
   * @private
   */
  this._requires = [];
  /**
   * List of <code>&#64;resource</code> items.
   * @type Array
   * @private
   */
  this._resources = [];
  /**
   * Should this script be wrapped into a function before being injected.
   * @type Boolean
   * @private
   */
  this._unwrap = false;
}


Script.prototype = {
  /**
   * Whether this script can run at a specified universal location.
   * <code>url</code> is checked against its sets of {@link #_includes} and
   * {@link #_excludes}.
   * @param {String} url    The URL to test.
   * @return {Boolean}      <code>true</code> if this script can run,
   *                        <code>false</code> otherwise.
   */
  matchesURL: function(url) {
    function test(page) {
      return convert2RegExp(page).test(url);
    }

    return this._includes.some(test) && !this._excludes.some(test);
  },

  /**
   * Notify observers of a change in this script's configuration.
   * @param {String} event  A label defining what has changed.
   * @param {Object} data   An associated payload.
   * @private
   */
  _changed: function(event, data) { this._config._changed(this, event, data); },

  get name() { return this._name; },
  get namespace() { return this._namespace; },
  get description() { return this._description; },
  get enabled() { return this._enabled; },
  set enabled(enabled) {
    this._enabled = enabled;
    this._changed("edit-enabled", enabled);
  },

  get includes() { return this._includes.concat(); },
  /**
   * Add an include mask.
   * @param {String} url    The URL include mask to add.
   */
  addInclude: function(url) {
    this._includes.push(url);
    this._changed("edit-include-add", url);
  },
  /**
   * Remove an include mask.
   * @param {Number} index  The index of the include mask to remove.
   */
  removeIncludeAt: function(index) {
    this._includes.splice(index, 1);
    this._changed("edit-include-remove", index);
  },

  get excludes() { return this._excludes.concat(); },
  /**
  * Add an exclude mask.
  * @param {String} url     The URL exclude mask to add.
  */
  addExclude: function(url) {
    this._excludes.push(url);
    this._changed("edit-exclude-add", url);
  },
  /**
  * Remove an exclude mask.
  * @param {Number} index   The index of the exclude mask to remove.
  */
  removeExcludeAt: function(index) {
    this._excludes.splice(index, 1);
    this._changed("edit-exclude-remove", index);
  },

  get requires() { return this._requires.concat(); },
  get resources() { return this._resources.concat(); },
  get unwrap() { return this._unwrap; },

  get _file() {
    var file = this._basedirFile;
    file.append(this._filename);
    return file;
  },

  get editFile() { return this._file; },

  get _basedirFile() {
    var file = this._config._scriptDir;
    file.append(this._basedir);
    file.normalize();
    return file;
  },

  get fileURL() { return getUriFromFile(this._file).spec; },
  get textContent() { return getTextContent(this._file); },

  /**
   * Craft a proper directory/file name.
   * Spaces are replaced by an underscore, non-Latin chars are removed (if a
   * name only contains non-Latin chars, <code>gm_script</code> is used as a
   * default name). Names longer than 24 chars are truncated.
   * @param {String} name       The script name to process.
   * @param {Boolean} useExt    Whether <code>name</code> includes a file
   *                            extension.
   * @return {String}           The corresponding directory/file name.
   * @private
   */
  _initFileName: function(name, useExt) {
    var ext = "";
    name = name.toLowerCase();

    var dotIndex = name.lastIndexOf(".");
    if (dotIndex > 0 && useExt) {
      ext = name.substring(dotIndex + 1);
      name = name.substring(0, dotIndex);
    }

    name = name.replace(/\s+/g, "_").replace(/[^-_A-Z0-9]+/gi, "");
    ext = ext.replace(/\s+/g, "_").replace(/[^-_A-Z0-9]+/gi, "");

    // If no Latin characters found - use default
    if (!name) name = "gm_script";

    // 24 is a totally arbitrary max length
    if (name.length > 24) name = name.substring(0, 24);

    if (ext) name += "." + ext;

    return name;
  },

  /**
   * Move a temporary script file to its final location.
   * Used during the script install process.
   * @param {nsIFile} tempFile  The temporary file to install.
   * @private
   */
  _initFile: function(tempFile) {
    var file = this._config._scriptDir;
    var name = this._initFileName(this._name, false);

    file.append(name);
    file.createUnique(Components.interfaces.nsIFile.DIRECTORY_TYPE, 0755);
    this._basedir = file.leafName;

    file.append(name + ".user.js");
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
    this._filename = file.leafName;

//    GM_log("Moving script file from " + tempFile.path + " to " + file.path);

    file.remove(true);
    tempFile.moveTo(file.parent, file.leafName);
  },

  /**
   * Get this script download URL.
   * @return {String}       The download URL.
   */
  get urlToDownload() { return this._downloadURL; },
  /**
   * Set this script's temporary file.
   * @param {nsIFile} file      Target temporary file.
   */
  setDownloadedFile: function(file) { this._tempFile = file; },

  
  get previewURL() {
    return Components.classes["@mozilla.org/network/io-service;1"]
                     .getService(Components.interfaces.nsIIOService)
                     .newFileURI(this._tempFile).spec;
  }
};


/**
 * Construct a new require object.
 * @constructor
 * @param {Script} script   Parent script.
 *
 * @class   Implementation of some <code>&#64;require</code> functionalities.
 */
function ScriptRequire(script) {
  /**
   * The parent script.
   * @type Script
   * @private
   */
  this._script = script;

  /**
   * URL to download this <code>&#64;require</code> from.
   * @type String
   * @private
   */
  this._downloadURL = null; // Only for scripts not installed
  /**
   * Temporary file used during the installation process.
   * @type nsIFile
   * @private
   */
  this._tempFile = null; // Only for scripts not installed
  /**
   * <code>&#64;require</code> file name (storage in the {@link Script#_basedir}
   * directory).
   * @type String
   * @private
   */
  this._filename = null;
}

ScriptRequire.prototype = {
  get _file() {
    var file = this._script._basedirFile;
    file.append(this._filename);
    return file;
  },

  get fileURL() { return getUriFromFile(this._file).spec; },
  get textContent() { return getTextContent(this._file); },

  /**
  * Move a temporary required file to its final location.
  * Used during the script install process.
  * @private
  */
  _initFile: function() {
    var name = this._downloadURL.substr(this._downloadURL.lastIndexOf("/") + 1);
    if(name.indexOf("?") > 0) {
      name = name.substr(0, name.indexOf("?"));
    }
    name = this._script._initFileName(name, true);

    var file = this._script._basedirFile;
    file.append(name);
    file.createUnique(Components.interfaces.nsIFile.NORMAL_FILE_TYPE, 0644);
    this._filename = file.leafName;

//    GM_log("Moving dependency file from " + this._tempFile.path + " to " + file.path);

    file.remove(true);
    this._tempFile.moveTo(file.parent, file.leafName);
    this._tempFile = null;
  },

  get urlToDownload() { return this._downloadURL; },
  /**
  * Set this require's temporary file.
  * @param {nsIFile} file      Target temporary file.
  */
  setDownloadedFile: function(file) { this._tempFile = file; }
};


/**
 * Construct a new resource object.
 * @constructor
 * @param {Script} script   Parent script.
 *
 * @class   Implementation of some <code>&#64;resource</code> functionalities.
 */
function ScriptResource(script) {
  /**
  * The parent script.
  * @type Script
  * @private
  */
  this._script = script;

  /**
   * URL to download this <code>&#64;resource</code> from.
   * @type String
   * @private
   */
  this._downloadURL = null; // Only for scripts not installed
  /**
   * Temporary file used during the installation process.
   * @type nsIFile
   * @private
   */
  this._tempFile = null; // Only for scripts not installed
  /**
   * <code>&#64;resource</code> file name (storage in the
   * {@link Script#_basedir} directory).
   * @type String
   * @private
   */
  this._filename = null;
  /**
   * File mime type.
   * @type String
   * @private
   */
  this._mimetype = null;
  
  /**
   * File charset.
   * @type String
   * @private
   */
  this._charset = null;

  /**
   * <code>&#64;resource</code> name
   * @type String
   * @private
   */
  this._name = null;
}

ScriptResource.prototype = {
  get name() { return this._name; },

  get _file() {
    var file = this._script._basedirFile;
    file.append(this._filename);
    return file;
  },

  get textContent() { return getTextContent(this._file); },

  get dataContent() {
    var appSvc = Components.classes["@mozilla.org/appshell/appShellService;1"]
                           .getService(Components.interfaces.nsIAppShellService);

    var window = appSvc.hiddenDOMWindow;
    var binaryContents = getBinaryContent(this._file);

    var mimetype = this._mimetype;
    if (this._charset && this._charset.length > 0) {
      mimetype += ";charset=" + this._charset;
    }

    return "data:" + mimetype + ";base64," +
      window.encodeURIComponent(window.btoa(binaryContents));
  },

  /**
  * Move a temporary resource file to its final location.
  * Used during the script install process.
  * @private
  */
  _initFile: ScriptRequire.prototype._initFile,

  get urlToDownload() { return this._downloadURL; },
  /**
  * Set this resource's temporary file.
  * @param {nsIFile} file       Target temporary file.
  * @param {String}  mimetype   File mime type.
  * @param {String}  charset    File charset.
  */
  setDownloadedFile: function(file, mimetype, charset) {
    this._tempFile = file;
    this._mimetype = mimetype;
    this._charset = charset;
  }
};
