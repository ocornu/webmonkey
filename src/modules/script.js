/**
 * @fileoverview JS Module implementation of a script.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["Script", "ScriptRequire", "ScriptResource"];


Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                   .getService(Components.interfaces.mozIJSSubScriptLoader)
                   .loadSubScript("resource://webmonkey/lib/convert2RegExp.js");
Components.utils.import("resource://webmonkey/lib/file.js");


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
    var file = new File(this._basedirFile);
    file.name = this._filename;
    return file;
  },

  get editFile() { return this._file._nsIFile; },

  get _basedirFile() {
    var file = new File(this._config._scriptDir);
    file.name = this._basedir;
    return file;
  },

  get fileURL() { return this._file.uri.spec; },
  get textContent() { return this._file.readText(); },

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
    var file = new File(this._config._scriptDir);
    var name = this._initFileName(this._name, false);
    // create script directory
    file.name = name;
    file.createUnique(File.DIRECTORY);
    this._basedir = file.name;
    // create script file
    this._filename = name + ".user.js";
    tempFile.moveTo(file._nsIFile, this._filename);
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
  },
  
  load: function(node) {
    this._basedir     = node.getAttribute("basedir");
    this._filename    = node.getAttribute("filename");
    this._name        = node.getAttribute("name");
    this._namespace   = node.getAttribute("namespace");
    this._description = node.getAttribute("description");
    this._enabled     = node.getAttribute("enabled") == true.toString();
  
    for (var i = 0, childNode; childNode = node.childNodes[i]; i++)
      switch (childNode.nodeName) {
      case "Include":
        this._includes.push(childNode.firstChild.nodeValue);
        break;
      case "Exclude":
        this._excludes.push(childNode.firstChild.nodeValue);
        break;
      case "Require":
        this._requires.push(new ScriptRequire(this, childNode));
        break;
      case "Resource":
        this._resources.push(new ScriptResource(this, childNode));
        break;
      case "Unwrap":
        this._unwrap = true;
        break;
      }
    return this;
  },

  save: function(doc) {
    var node = doc.createElement("Script");

    node.setAttribute("basedir", this._basedir);
    node.setAttribute("filename", this._filename);
    node.setAttribute("name", this._name);
    node.setAttribute("namespace", this._namespace);
    node.setAttribute("description", this._description);
    node.setAttribute("enabled", this._enabled);
    for each (var include in this._includes) {
      var includeNode = doc.createElement("Include");
      includeNode.appendChild(doc.createTextNode(include));
      append(includeNode);
    }
    for each (var exclude in this._excludes) {
      var excludeNode = doc.createElement("Exclude");
      excludeNode.appendChild(doc.createTextNode(exclude));
      append(excludeNode);
    }
    for each (var require in this._requires) {
      var requireNode = doc.createElement("Require");
      require.save(requireNode);
      append(requireNode);
    }
    for each (var resource in this._resources) {
      var resourceNode = doc.createElement("Resource");
      resource.save(resourceNode);
      append(resourceNode);
    }
    if (this._unwrap)
      append(doc.createElement("Unwrap"));

    node.appendChild(doc.createTextNode("\n\t"));
    return node;
    
    function append(childNode) {
      node.appendChild(doc.createTextNode("\n\t\t"));
      node.appendChild(childNode);
    }
  }
  
};


/**
 * Construct a new require object.
 * @constructor
 * @param script    Parent script.
 * @param [node]    XML node from config file.
 *
 * @class   Implementation of some <code>&#64;require</code> functionalities.
 */
function ScriptRequire(/**Script*/ script, /**nsIDOMNode*/ node) {
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

  if (node)
    this._load(node);
}

ScriptRequire.prototype = {
  get _file() {
    var file = new File(this._script._basedirFile);
    file.name = this._filename;
    return file;
  },

  get fileURL() { return this._file.uri.spec; },
  get textContent() { return this._file.readText(); },

  /**
  * Move a temporary required file to its final location.
  * Used during the script install process.
  * @private
  */
  _initFile: function() {
    // build a file name
    var name = this._downloadURL.substr(this._downloadURL.lastIndexOf("/") + 1);
    if(name.indexOf("?") > 0)
      name = name.substr(0, name.indexOf("?"));
    name = this._script._initFileName(name, true);
    // create file
    var file = new File(this._script._basedirFile);
    file.name = name;
    file.createUnique(File.FILE, 0644);
    this._filename = file.name;

//    GM_log("Moving dependency file from " + this._tempFile.path + " to " + file.path);

    file.remove(true);
    this._tempFile.moveTo(file.parent, file.name);
    this._tempFile = null;
  },

  get urlToDownload() { return this._downloadURL; },
  /**
  * Set this require's temporary file.
  * @param {nsIFile} file      Target temporary file.
  */
  setDownloadedFile: function(file) { this._tempFile = file; },
  
  _load: function(node) {
    this._filename = node.getAttribute("filename");
  },
  
  save: function(node) {
    node.setAttribute("filename", this._filename);
  }

};


/**
 * Construct a new resource object.
 * @constructor
 * @param script    Parent script.
 * @param [node]    XML node from config file.
 *
 * @class   Implementation of some <code>&#64;resource</code> functionalities.
 */
function ScriptResource(/**Script*/ script, /**nsIDOMNode*/ node) {
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

  if (node)
    this._load(node);
}

ScriptResource.prototype = {
  get name() { return this._name; },

  get _file() {
    var file = new File(this._script._basedirFile);
    file.name = this._filename;
    return file;
  },

  get textContent() { return this._file.readText(); },

  get dataContent() {
    var appSvc = Components.classes["@mozilla.org/appshell/appShellService;1"]
                           .getService(Components.interfaces.nsIAppShellService);

    var window = appSvc.hiddenDOMWindow;
    var binaryContents = this._file.readBytes();

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
  },
  
  _load: function(node) {
    this._name     = node.getAttribute("name");
    this._filename = node.getAttribute("filename");
    this._mimetype = node.getAttribute("mimetype");
    this._charset  = node.getAttribute("charset");
  },

  save: function(node) {
    node.setAttribute("name", this._name);
    node.setAttribute("filename", this._filename);
    node.setAttribute("mimetype", this._mimetype);
    if (this._charset)
      node.setAttribute("charset", this._charset);
  }

};
