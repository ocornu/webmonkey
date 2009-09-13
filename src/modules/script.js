/**
 * @fileoverview JS Module implementation of a script.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["Script"];


const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// import dependencies
Cc["@mozilla.org/moz/jssubscript-loader;1"]
  .getService(Ci.mozIJSSubScriptLoader)
  .loadSubScript("resource://webmonkey/lib/convert2RegExp.js");
Cu.import("resource://webmonkey/file.js");
Cu.import("resource://webmonkey/prefmanager.js");


const IO      = Cc["@mozilla.org/network/io-service;1"]
                   .getService(Ci.nsIIOService);
const SHELL   = Cc["@mozilla.org/appshell/appShellService;1"]
                   .getService(Ci.nsIAppShellService);
const CONSOLE = Cc["@mozilla.org/consoleservice;1"]
                  .getService(Ci.nsIConsoleService);
const FILE    = Components.stack.filename;


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
   * @type Script.MetaData
   */
  this.meta = new Script.MetaData(this);
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
      this._api = new Script.Api(this);
    var sandbox = this._api.sandbox(unsafeWin, gmBrowser, console); 
    var jsVersion = "1.6";
    // @requires source files
    for each(var require in this.meta.requires)
      this._inject(require, sandbox, jsVersion);
    // script source file
    this._inject(this, sandbox, jsVersion);
  },

  _inject: function(/**Script|Script.Require*/    source,
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
 * Construct a new script meta-data object.
 * @constructor
 * @param script    Parent script.
 *
 * @class Implementation of scripts meta-data.
 */
Script.MetaData = function(/**Script*/ script) {
  /**
   * Parent Script.
   * @type Script
   * @private
   */
  this._script = script;
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
  this.includes = [];
  /**
   * List of <code>&#64;exclude</code> URL masks.
   * @type string[]
   */
  this.excludes = [];
  /**
   * List of <code>&#64;require</code> items.
   * @type Script.Require[]
   */
  this.requires = [];
  /**
   * List of <code>&#64;resource</code> items.
   * @type Script.Resource[]
   */
  this.resources = [];
  /**
   * Enabled/disabled state.
   * @type boolean
   * @private
   */
  this._enabled = false;
};
Script.MetaData.prototype = {
  /**
   * Enabled/disabled state.
   * @type boolean
   */
  get enabled() { return this._enabled; },
  set enabled(enabled) {
    this._enabled = enabled;
    this._script._changed("edit-enabled", enabled);
  },

  get sourceFiles() {
    var files = [];
    for each(var require in this.requires)
      files.push(require.file.uri.spec);
    files.push(this._script.file.uri.spec);
    return files;
  },
  
  /**
   * Add an include mask.
   * @param url    The URL include mask to add.
   */
  addInclude: function(/**string*/ url) {
    this.includes.push(url);
    this._script._changed("edit-include-add", url);
  },
  /**
   * Remove an include mask.
   * @param index  The index of the include mask to remove.
   */
  removeIncludeAt: function(/**int*/ index) {
    this.includes.splice(index, 1);
    this._script._changed("edit-include-remove", index);
  },

  /**
   * Add an exclude mask.
   * @param url     The URL exclude mask to add.
   */
  addExclude: function(/**string*/ url) {
    this.excludes.push(url);
    this._script._changed("edit-exclude-add", url);
  },
  /**
   * Remove an exclude mask.
   * @param index   The index of the exclude mask to remove.
   */
  removeExcludeAt: function(/**int*/ index) {
    this.excludes.splice(index, 1);
    this._script._changed("edit-exclude-remove", index);
  },

  /**
   * Find the {@link Script.Resource} with the given resource name.
   * @param aName   The resource name to look for.
   * @return {Script.Resource}  The resource named <code>aName</code>.
   * @throws Error            If there is no such resource.
   */
  getResource: function(/**string*/ aName) {
    for each(var resource in this.resources)
      if (resource._name == aName)
        return resource;
    throw new Error("No resource with name: " + aName); // NOTE: Non localised string
  },

  fromXml: function(/**nsIDOMNode*/ node) {
    this.name        = node.getAttribute("name");
    this.namespace   = node.getAttribute("namespace");
    this.description = node.getAttribute("description");
    this._enabled    = node.getAttribute("enabled") == true.toString();
    for (var i = 0, childNode; childNode = node.childNodes[i]; i++)
      switch (childNode.nodeName) {
      case "Include":
        this.includes.push(childNode.firstChild.nodeValue);
        break;
      case "Exclude":
        this.excludes.push(childNode.firstChild.nodeValue);
        break;
      case "Require":
        this.requires.push(new Script.Require(this._script, childNode));
        break;
      case "Resource":
        this.resources.push(new Script.Resource(this._script, childNode));
        break;
      }
  },

  toXml: function(doc, node) {
    node.setAttribute("name", this.name);
    node.setAttribute("namespace", this.namespace);
    node.setAttribute("description", this.description);
    node.setAttribute("enabled", this._enabled);
    for each (var include in this.includes) {
      var includeNode = doc.createElement("Include");
      includeNode.appendChild(doc.createTextNode(include));
      append(includeNode);
    }
    for each (var exclude in this.excludes) {
      var excludeNode = doc.createElement("Exclude");
      excludeNode.appendChild(doc.createTextNode(exclude));
      append(excludeNode);
    }
    for each (var require in this.requires) {
      var requireNode = doc.createElement("Require");
      require.toXml(requireNode);
      append(requireNode);
    }
    for each (var resource in this.resources) {
      var resourceNode = doc.createElement("Resource");
      resource.toXml(resourceNode);
      append(resourceNode);
    }
    
    function append(childNode) {
      node.appendChild(doc.createTextNode("\n\t\t"));
      node.appendChild(childNode);
    }
  },

  parse: function(source, uri) {
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
          this.includes.push(value);
          break;
        case "exclude":
          this.excludes.push(value);
          break;
        case "require":
          var require = new Script.Require(this._script);
          require.parse(value, uri);
          this.requires.push(require);
          break;
        case "resource":
          var resource = new Script.Resource(this._script);
          resource.parse(value, uri);
          this.resources.push(resource);
          break;
        }
    }
    
    // if no meta info, default to reasonable values
    if (this.name == null) this.name = parseScriptName(uri);
    if (this.namespace == null) this.namespace = uri.host;
    if (!this.description) this.description = "";
    if (!this.includes.length) this.includes.push("*");
    this._enabled = true;

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

  /**
   * File text content.
   * @type string
   */
  get textContent() { return this.file.readText(); },

  /**
   * File <code>data:*</code> content.
   * @type string
   */
  get dataContent() {
    var window = SHELL.hiddenDOMWindow;
    var binaryContents = this.file.readBytes();

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

  parse: function(/**string*/ value, /**nsIURI*/ baseUri) {
    var res = value.match(/(\S+)\s+(.*)/);
    if (res === null)   // NOTE: Unlocalized strings
      throw new Error("Invalid syntax for @resource declaration '" +
                      value + "'. Resources are declared like this: " +
                      "@resource <name> <URI>");
    this._name = res[1];
    this._downloadURL = File.getUri(res[2], baseUri).spec;
    // assert there is no duplicate resource name
    var existing = this._script.meta.resources;
    for each (var resource in existing)
      if (resource._name == this._name)
        throw new Error("Duplicate resource name '" + this._name + "' " +
                        "detected. Each resource must have a unique name.");
  }
};
Script.Resource.prototype.__proto__ = Script.Require.prototype;


/**
 * Construct a new script API object.
 * @constructor
 * @param script    Parent script.
 *
 * @class   Implementation of the GM script API logic.<br>
 * This class contains the GM_* API methods and the {@link Script.Api#sandbox}
 * factory method.
 */
Script.Api = function(/**Script*/ script) {
  /**
   * Parent script.
   * @type Script
   */
  this._script = script;
  
  /**
   * Script unique identifier.
   * @type string
   */
  this._id = script.meta.namespace;
  if (this._id.substring(this._id.length-1) != "/")
    this._id += "/";
  this._id += script.meta.name;
  
  /**
   * Script values manager.
   * @type PreferenceManager 
   */
  this._prefs = GM_prefRoot.subManager("scriptvals." + this._id);
  
  /**
   * Source files path.
   * @type string[]
   */
  this._files = script.meta.sourceFiles;
}
Script.Api.prototype = {
/*
 * GM API methods
 */
  /**
   * See <a href="http://wiki.greasespot.net/GM_addStyle">GM wiki definition</a>.
   */
  GM_addStyle: function(/**nsIDOMDocument*/ doc, /**string*/ aCss) {
    var head = doc.getElementsByTagName("head")[0];
    if (!head)
      return false;
    var style = doc.createElement("style");
    style.type = "text/css";
    style.innerHTML = aCss;
    head.appendChild(style);
  },

  /**
   * See <a href="http://wiki.greasespot.net/GM_log">GM wiki definition</a>.
   */
  GM_log: function(/**string*/ aMessage) {
    CONSOLE.logStringMessage(this._id + ":  "+ aMessage);
  },

  /**
   * See <a href="http://wiki.greasespot.net/GM_getValue">GM wiki definition</a>.
   * @return {object}
   */
  GM_getValue: function(/**string*/ aKey, /**object*/ aDefaultValue) {
    this._apiLeakCheck("GM_getValue");
    return this._prefs.get(aKey, aDefaultValue);
  },
  /**
   * See <a href="http://wiki.greasespot.net/GM_setValue">GM wiki definition</a>.
   */
  GM_setValue: function(/**string*/ aKey, /**object*/ aValue) {
    this._apiLeakCheck("GM_setValue");
    this._prefs.set(aKey, aValue);
  },
  /**
   * See <a href="http://wiki.greasespot.net/GM_deleteValue">GM wiki definition</a>.
   */
  GM_deleteValue: function(/**string*/ aKey) {
    this._apiLeakCheck("GM_deleteValue");
    this._prefs.remove(aKey);
  },
  /**
   * See <a href="http://wiki.greasespot.net/GM_listValues">GM wiki definition</a>.
   * @return {string[]}
   */
  GM_listValues: function() {
    this._apiLeakCheck("GM_listValues");
    return this._prefs.list();
  },
  
  /**
   * See <a href="http://wiki.greasespot.net/GM_openInTab">GM wiki definition</a>.
   */
  GM_openInTab: function(/**GM_BrowserUI*/ gmBrowser, /**string*/ aUrl) {
    gmBrowser.tabBrowser.addTab(aUrl);
  },

  /**
   * See <a href="http://wiki.greasespot.net/GM_xmlhttpRequest">GM wiki definition</a>.
   */
  GM_xmlhttpRequest: function(/**Script.Api.XMLHttpRequester*/ xhr,
                              /**Object**/ aDetails) {
    this._apiLeakCheck("GM_xmlhttpRequest");
    xhr.contentStartRequest(aDetails);
  },
  
  /**
   * See <a href="http://wiki.greasespot.net/GM_registerMenuCommand">GM wiki definition</a>.
   */
  GM_registerMenuCommand: function(/**GM_BrowserUI*/ gmBrowser,
                                   /**nsiDOMWindow*/ unsafeWin,
                                   /**string*/   aCommandName,
                                   /**Function*/ aCallback,
                                   /**string*/   aAccelKey,
                                   /**string*/   aAccelModifiers,
                                   /**string*/   aAccessKey) {
    this._apiLeakCheck("GM_registerMenuCommand");
    var commander = gmBrowser.getCommander(unsafeWin);
    commander.registerMenuCommand(aCommandName, aCallback, aAccelKey,
                                  aAccelModifiers, aAccessKey);
  },

  /**
   * See <a href="http://wiki.greasespot.net/GM_getResourceText">GM wiki definition</a>.
   * @return {string}
   */
  GM_getResourceText: function(/**string*/ aName) {
    this._apiLeakCheck("GM_getResourceText");
    return this._script.meta.getResource(aName).textContent;
  },
  /**
   * See <a href="http://wiki.greasespot.net/GM_getResourceURL">GM wiki definition</a>.
   * @return {string}
   */
  GM_getResourceURL: function(/**string*/ aName) {
    this._apiLeakCheck("GM_getResourceURL");
    return this._script.meta.getResource(aName).dataContent;
  },
/*
 * Internal use methods
 */
  /**
   * Protect sensitive API methods from page-land leaks.<br>
   * Examines the stack to detect page-land calls.
   * @param apiName     The API method name we are protecting.
   * @throws Error    If the call-stack is stained.
   */
  _apiLeakCheck: function(/**string*/ apiName) {
    var stack = Components.stack;
    do {
      // Valid stack frames for GM api calls are: native and js when coming from
      // chrome:// URLs and the greasemonkey.js component's file:// URL.
      if (stack.language == 2
          && stack.filename != null
          && stack.filename.substr(0, 6) != "chrome" 
          && stack.filename != FILE 
          && this._files.indexOf(stack.filename) == -1)
        throw this.logError(new Error("Webmonkey access violation: "+stack.filename+
                                      " cannot call "+apiName+"()."));
      stack = stack.caller;
    } while (stack);
  },
  
  /**
   * Sandbox factory method: creates a sandbox and populates it with our API.
   * @param unsafeWin   Target window.
   * @param gmBrowser   <code>GM_BrowserUI</code> responsible for this window.
   * @param [console]     Firebug console, if any.
   * @return {Components.utils.Sandbox}
   */
  sandbox: function(/**nsIDOMWindow*/   unsafeWin,
                   /**GM_BrowserUI*/    gmBrowser,
                   /**Firebug.Console*/ console) {
    var safeWin = new XPCNativeWrapper(unsafeWin);
    var sandbox = new Components.utils.Sandbox(safeWin);
    sandbox.window       = safeWin;
    sandbox.document     = safeWin.document;
    sandbox.unsafeWindow = unsafeWin;
    sandbox.XPathResult  = Ci.nsIDOMXPathResult;
    // firebug debugging
    sandbox.console      = console ? console : new Script.Api.Console(this);
    sandbox.importFunction(hasOwnProperty);
    sandbox.importFunction(__lookupGetter__);
    sandbox.importFunction(__lookupSetter__);
    // bind GM api
    this._bind(sandbox, "GM_addStyle", safeWin.document);
    this._bind(sandbox, "GM_log");
    this._bind(sandbox, "GM_getValue");
    this._bind(sandbox, "GM_setValue");
    this._bind(sandbox, "GM_deleteValue");
    this._bind(sandbox, "GM_listValues");
    this._bind(sandbox, "GM_openInTab", gmBrowser);
    this._bind(sandbox, "GM_xmlhttpRequest",
               new Script.Api.XmlHttpRequest(unsafeWin));
    this._bind(sandbox, "GM_registerMenuCommand", gmBrowser, unsafeWin);
    this._bind(sandbox, "GM_getResourceText");
    this._bind(sandbox, "GM_getResourceURL");
    // run in safe-window land
    sandbox.__proto__ = safeWin;
    return sandbox;
  },
  
  /**
   * Bind a GM API method to the a sandbox.<br>
   * Additional arguments are passed to the target method on every call.
   * @param sandbox     The sandbox to bind this API method to.
   * @param method      The API method being binded.
   */
  _bind: function(/**Components.utils.Sandbox*/ sandbox, /**string*/ method) {
    var staticArgs = Array.prototype.splice.call(arguments, 2, arguments.length);
    var self = this;
    sandbox[method] = function() {
      var args = staticArgs.concat();
      for (var i = 0; i < arguments.length; i++)
        args.push(arguments[i]);
        return self[method].apply(self, args);
    };
  },
  
  /**
   * Log an error to the JS console without throwing an actual error.<br>
   * Will attempt to find a relevant source for this error in the script source
   * files and update the <code>Error</code> object accordingly. 
   * @param error       The error to log.
   * @return {Error}    The error logged.
   */
  logError: function (/**Error*/ error) {
    if (this._files.indexOf(error.fileName)==-1) {
      // Search the first occurrence of one of our source files in the call stack
      var stack = Components.stack;
      while (stack && this._files.indexOf(stack.filename)==-1)
        stack = stack.caller;
      if (stack) {
        error.fileName = stack.filename;
        error.lineNumber = stack.lineNumber;
        error.columnNumber = 0;
      }
    }
    var consoleError = Cc["@mozilla.org/scripterror;1"]
                         .createInstance(Ci.nsIScriptError);
    consoleError.init(error.message, error.fileName, null,
                      error.lineNumber, error.columnNumber, 0, null);
    CONSOLE.logMessage(consoleError);
    return error;
  }
};


/**
 * Construct a new Console object.
 * @constructor
 * @param api    Parent script API.
 *
 * @class   Dummy implementation of the Firebug console in order to prevent
 * scripts from breaking when Firebug is not installed. Messages are logged
 * in the JS console.
 */
Script.Api.Console = function(/**Script.Api*/ api) {
  /**
   * Log a message to the JS console.<br>
   * Accepts additional arguments that will be logged on individual lines.
   * @param aMessage    The message to log.
   */
  this.log = function(/**string*/ aMessage) {
    api.GM_log( Array.prototype.slice.apply(arguments).join("\n") );
  };
}
Script.Api.Console.prototype = {
  /**
   * Never break on other Firebug.Console API calls.
   */
  __noSuchMethod__: function() {}
};


/**
 * Construct a new XMLHttpRequest object.
 * @constructor
 * @param unsafeWin    Parent window.
 *
 * @class   Implementation of the GM_xmlhttpRequest logic.
 */
Script.Api.XmlHttpRequest = function(/**nsIDOMWindow*/ unsafeWin) {
  this.unsafeWin = unsafeWin;
  this.chromeWin = SHELL.hiddenDOMWindow;
}
Script.Api.XmlHttpRequest.prototype = {
  //this function gets called by user scripts in content security scope to
  //start a cross-domain xmlhttp request.
  //
  //details should look like:
  //{method,url,onload,onerror,onreadystatechange,headers,data}
  //headers should be in the form {name:value,name:value,etc}
  //can't support mimetype because i think it's only used for forcing
  //text/xml and we can't support that
  contentStartRequest: function(details) {
    // important to store this locally so that content cannot trick us up with
    // a fancy getter that checks the number of times it has been accessed,
    // returning a dangerous URL the time that we actually use it.
    var url = details.url;
    if (typeof url != "string")
      throw new Error("Invalid url: url must be of type string");
    var scheme = IO.extractScheme(url);
    switch (scheme) {
      case "http":
      case "https":
      case "ftp":
        this.chromeWin.setTimeout(
          bind(this, "_chromeStartRequest", url, details), 0);
        break;
      default:
        throw new Error("Invalid url: " + url);
    }
  },

  // this function is intended to be called in chrome's security context, so
  // that it can access other domains without security warning
  _chromeStartRequest: function(safeUrl, details) {
    var req = new this.chromeWin.XMLHttpRequest();
    this._setupRequestEvent(this.unsafeWin, req, "onload", details);
    this._setupRequestEvent(this.unsafeWin, req, "onerror", details);
    this._setupRequestEvent(this.unsafeWin, req, "onreadystatechange", details);
    req.open(details.method, safeUrl);
    if (details.overrideMimeType)
      req.overrideMimeType(details.overrideMimeType);
  
    if (details.headers)
      for (var prop in details.headers)
        req.setRequestHeader(prop, details.headers[prop]);
  
    if (details.nocache)
      try {
        req.channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE;
      } catch (e) {
        throw new Error("Could not set 'bypass cache' option");
      }
  
    var body = details.data ? details.data : null;
    if (details.binary)
      req.sendAsBinary(body);
    else
      req.send(body);
  },

  // arranges for the specified 'event' on xmlhttprequest 'req' to call the
  // method by the same name which is a property of 'details' in the content
  // window's security context.
  _setupRequestEvent: function(unsafeWin, req, event, details) {
    if (!details[event])
      return;
    req[event] = function() {
      var responseState = {
        // can't support responseXML because security won't
        // let the browser call properties on it
        responseText:    req.responseText,
        readyState:      req.readyState,
        responseHeaders:(req.readyState == 4 && event != "onerror" ?
                         req.getAllResponseHeaders() :
                         ""),
        status:         (req.readyState == 4 ? req.status : 0),
        statusText:     (req.readyState == 4 && event != "onerror" ?
                        req.statusText : ""),
        finalUrl:       (req.readyState == 4 ? req.channel.URI.spec : "")
      }
      // Pop back onto browser thread and call event handler.
      // Have to use nested function here instead of GM_hitch because
      // otherwise details[event].apply can point to window.setTimeout, which
      // can be abused to get increased priveleges.
      new XPCNativeWrapper(unsafeWin, "setTimeout()")
        .setTimeout(function() { details[event](responseState); }, 0);
    }
  }
}


/*
 * Helper functions
 */


function bind(/**Object*/ object, /**string*/ method) {
  var staticArgs = Array.prototype.splice.call(arguments, 2, arguments.length);
  return function() {
    var args = staticArgs.concat();
    for (var i = 0; i < arguments.length; i++)
      args.push(arguments[i]);
    return object[method].apply(object, args);
  };
}


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


/*
 * These functions are added to scripts sandbox so that Firebug's DOM module
 * can properly show the sandbox object hierarchy.
 */
function hasOwnProperty(prop) {
  return prop in this;
}
function __lookupGetter__() { return null; }
function __lookupSetter__() { return null; }
