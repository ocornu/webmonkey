/**
 * @fileoverview JS Module implementation of a script.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["Script"];


Components.classes["@mozilla.org/moz/jssubscript-loader;1"]
                   .getService(Components.interfaces.mozIJSSubScriptLoader)
                   .loadSubScript("resource://webmonkey/lib/convert2RegExp.js");
Components.utils.import("resource://webmonkey/file.js");


/**
 * Construct a new script object.<br>
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
   * @type Script.MetaData
   * @private
   */
  this._meta = new Script.MetaData();
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

  /**
   * Enabled/disabled state.
   * @type boolean
   * @private
   */
  this._enabled = true;
}


Script.prototype = {
  /**
   * Whether this script can run at a specified universal location.
   * <code>url</code> is checked against its sets of {@link #_includes} and
   * {@link #_excludes}.
   * @param url         The URL to test.
   * @return {boolean}  <code>true</code> if this script can run,
   *                    <code>false</code> otherwise.
   */
  matchesURL: function(/**string*/ url) {
    function test(page) {
      return convert2RegExp(page).test(url);
    }

    return this._meta.include.some(test) && !this._meta.exclude.some(test);
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

  get name() { return this._meta.name; },
  get namespace() { return this._meta.namespace; },
  get description() { return this._meta.description; },
  get enabled() { return this._enabled; },
  set enabled(enabled) {
    this._enabled = enabled;
    this._changed("edit-enabled", enabled);
  },

  get includes() { return this._meta.include.concat(); },
  /**
   * Add an include mask.
   * @param url    The URL include mask to add.
   */
  addInclude: function(/**string*/ url) {
    this._meta.include.push(url);
    this._changed("edit-include-add", url);
  },
  /**
   * Remove an include mask.
   * @param index  The index of the include mask to remove.
   */
  removeIncludeAt: function(/**int*/ index) {
    this._meta.include.splice(index, 1);
    this._changed("edit-include-remove", index);
  },

  get excludes() { return this._meta.exclude.concat(); },
  /**
   * Add an exclude mask.
   * @param url     The URL exclude mask to add.
   */
  addExclude: function(/**string*/ url) {
    this._meta.exclude.push(url);
    this._changed("edit-exclude-add", url);
  },
  /**
   * Remove an exclude mask.
   * @param index   The index of the exclude mask to remove.
   */
  removeExcludeAt: function(/**int*/ index) {
    this._meta.exclude.splice(index, 1);
    this._changed("edit-exclude-remove", index);
  },

  get requires() { return this._meta.require.concat(); },
  get resources() { return this._meta.resource.concat(); },
  get unwrap() { return this._meta.unwrap; },

  get _file() {
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
    editor.exec([this._file.path]);
  },

  get textContent() { return this._file.readText(); },

  /**
   * Install a script.<br>
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

  get previewURL() {
    return "view-source:" + this._file.uri.spec;
  },
  
  _fromXml: function(/**nsIDOMNode*/ node, /**File*/ dir) {
    this._directory = new File(dir);
    this._directory.name = node.getAttribute("basedir");
    this._filename = node.getAttribute("filename");
    this._enabled = node.getAttribute("enabled") == true.toString();
    this._meta.fromXml(this, node);
  },

  /**
   * @return {nsIDOMNode}
   */
  toXml: function(/**nsIDOMDocument*/ doc) {
    var node = doc.createElement("Script");
    node.setAttribute("basedir", this._directory.name);
    node.setAttribute("filename", this._filename);
    node.setAttribute("enabled", this._enabled);
    this._meta.toXml(doc, node);
    node.appendChild(doc.createTextNode("\n\t"));
    return node;
  },

  _parse: function(source) {
    this._enabled = true;
    this._meta.parse(this, source);
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
      deps = this._meta.require.concat(this._meta.resource);
    if (deps.length == 0)
      onSuccess(this);
    else
      deps.shift().fetch(onSuccess, onError, deps);
  }
};


/**
 * Factory method to create a new {@link Script} instance from its source code.
 * @param aSource   The script source code.
 * @return {Script}
 */
Script.fromSource = function(/**string*/ aSource) {
  var script = new Script();
  script._parse(aSource);
  // create temp script dir (max name length: 24)
  var name = toFilename(script.name, "script");
  if (name.length > 24) name = name.substring(0, 24);
  script._directory = File.temp();
  script._directory.name = name;
  script._directory.createUnique(File.DIR);
  // create script file
  script._filename = name + ".user.js";
  var file = script._file;
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
    var script = Script.fromSource(file.readText());
    script._downloadURL = aUri;
    file.remove();
    if (noDeps) return onSuccess(script);
    script.fetchDeps(onSuccess, onError);
  });
};


/**
 * Construct a new script meta-data object.
 * @constructor
 *
 * @class Implementation of scripts meta-data.
 */
Script.MetaData = function() {
  /**
   * Script <code>&#64;name</code>.
   * @type string
   */
  this.name = null;
  /**
   * Script <code>&#64;namespace</code>.
   * @type string
   */
  this.namespace = null;
  /**
   * Script <code>&#64;description</code>.
   * @type string
   */
  this.description = null;
  /**
   * List of <code>&#64;include</code> URL masks.
   * @type string[]
   */
  this.include = [];
  /**
   * List of <code>&#64;exclude</code> URL masks.
   * @type string[]
   */
  this.exclude = [];
  /**
   * List of <code>&#64;require</code> items.
   * @type Script.Require[]
   */
  this.require = [];
  /**
   * List of <code>&#64;resource</code> items.
   * @type Script.Resource[]
   */
  this.resource = [];
  /**
   * <code>&#64;unwrap</code> this script before injection.
   * @type boolean
   */
  this.unwrap = false;
};

Script.MetaData.prototype = {
  fromXml: function(/**Script*/ script, /**nsIDOMNode*/ node) {
    this.name        = node.getAttribute("name");
    this.namespace   = node.getAttribute("namespace");
    this.description = node.getAttribute("description");
    for (var i = 0, childNode; childNode = node.childNodes[i]; i++)
      switch (childNode.nodeName) {
      case "Include":
        this.include.push(childNode.firstChild.nodeValue);
        break;
      case "Exclude":
        this.exclude.push(childNode.firstChild.nodeValue);
        break;
      case "Require":
        this.require.push(new Script.Require(script, childNode));
        break;
      case "Resource":
        this.resource.push(new Script.Resource(script, childNode));
        break;
      case "Unwrap":
        this.unwrap = true;
        break;
      }
  },

  toXml: function(doc, node) {
    node.setAttribute("name", this.name);
    node.setAttribute("namespace", this.namespace);
    node.setAttribute("description", this.description);
    for each (var include in this.include) {
      var includeNode = doc.createElement("Include");
      includeNode.appendChild(doc.createTextNode(include));
      append(includeNode);
    }
    for each (var exclude in this.exclude) {
      var excludeNode = doc.createElement("Exclude");
      excludeNode.appendChild(doc.createTextNode(exclude));
      append(excludeNode);
    }
    for each (var require in this.require) {
      var requireNode = doc.createElement("Require");
      require.toXml(requireNode);
      append(requireNode);
    }
    for each (var resource in this.resource) {
      var resourceNode = doc.createElement("Resource");
      resource.toXml(resourceNode);
      append(resourceNode);
    }
    if (this.unwrap)
      append(doc.createElement("Unwrap"));
    
    function append(childNode) {
      node.appendChild(doc.createTextNode("\n\t\t"));
      node.appendChild(childNode);
    }
  },

  parse: function(script, source) {
    var meta = false;
    for each (var line in source.match(/.+/g)) {
      if (!meta) {
        if (line.indexOf("// ==UserScript==") == 0) meta = true;
        continue;
      }
      if (line.indexOf("// ==/UserScript==") == 0) break;
      var match = line.match(/\/\/ \@(\S+)(?:\s+([^\n]+))?/);
      if (match === null) continue;

      var header = match[1];
      var value  = match[2];
      if (value)          // @header <value>
        switch (header) {
        case "name":
        case "namespace":
        case "description":
          this[header] = value;
          break;
        case "include":
        case "exclude":
          this[header].push(value);
          break;
        case "require":
          var require = new Script.Require(script);
          require.parse(value);
          this.require.push(require);
          break;
        case "resource":
          var resource = new Script.Resource(script);
          resource.parse(value, this.resource);
          this.resource.push(resource);
          break;
        }
      else              // plain @header
        if (header == "unwrap")
          this.unwrap = true;
    }
    
    // if no meta info, default to reasonable values
    if (this.name == null) this.name = parseScriptName(uri);
    if (this.namespace == null) this.namespace = uri.host;
    if (!this.description) this.description = "";
    if (!this.include.length) this.include.push("*");

    function parseScriptName(sourceUri) {
      var name = sourceUri.spec;
      name = name.substring(0, name.indexOf(".user.js"));
      return name.substring(name.lastIndexOf("/") + 1);
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
Script.Require = function(/**Script*/ script, /**nsIDOMNode*/ node) {
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

Script.Require.prototype = {
  DEFAULT_FILENAME: "require.js",
  
  get _file() {
    var file = new File(this._script._directory);
    file.name = this._filename;
    return file;
  },

  get textContent() { return this._file.readText(); },

  _fromXml: function(/**nsIDOMNode*/ node) {
    this._filename = node.getAttribute("filename");
  },
  
  toXml: function(/**nsIDOMNode*/ node) {
    node.setAttribute("filename", this._filename);
  },

  parse: function(/**string*/ value) {
    this._downloadURL = File.getUri(value).spec;
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
 * Construct a new resource object.
 * @constructor
 * @param script    Parent script.
 * @param [node]    XML node from config file.
 *
 * @class   Implementation of some <code>&#64;resource</code> functionalities.
 * @augments Script.Require
 */
Script.Resource = function(/**Script*/ script, /**nsIDOMNode*/ node) {
  /**
   * The parent script.
   * @type Script
   * @private
   */
  this._script = script;

  /**
   * URL to download this <code>&#64;resource</code> from.
   * @type string
   * @private
   */
  this._downloadURL = null; // Only for scripts not installed
  /**
   * <code>&#64;resource</code> file name (storage in {@link Script#_directory}).
   * @type string
   * @private
   */
  this._filename = null;
  /**
   * File mime type.
   * @type string
   * @private
   */
  this._mimetype = null;
  
  /**
   * File charset.
   * @type string
   * @private
   */
  this._charset = null;

  /**
   * <code>&#64;resource</code> name
   * @type string
   * @private
   */
  this._name = null;

  if (node)
    this._fromXml(node);
};

Script.Resource.prototype = {
  DEFAULT_FILENAME: "resource",

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

  _fromXml: function(/**nsIDOMNode*/ node) {
    this._name     = node.getAttribute("name");
    this._filename = node.getAttribute("filename");
    this._mimetype = node.getAttribute("mimetype");
    this._charset  = node.getAttribute("charset");
  },

  toXml: function(/**nsIDOMNode*/ node) {
    node.setAttribute("name", this._name);
    node.setAttribute("filename", this._filename);
    node.setAttribute("mimetype", this._mimetype);
    if (this._charset)
      node.setAttribute("charset", this._charset);
  },

  parse: function(/**string*/ value, /**Script.Resource[]*/ existing) {
    var res = value.match(/(\S+)\s+(.*)/);
    if (res === null)   // NOTE: Unlocalized strings
      throw new Error("Invalid syntax for @resource declaration '" +
                      value + "'. Resources are declared like this: " +
                      "@resource <name> <URI>");
    this._name = res[1];
    this._downloadURL = File.getUri(res[2]).spec;
    // assert there is no duplicate resource name
    for each (var resource in existing)
      if (resource.name == this._name)
        throw new Error("Duplicate resource name '" + this._name + "' " +
                        "detected. Each resource must have a unique name.");
  }
};

Script.Resource.prototype.__proto__ = Script.Require.prototype;


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
