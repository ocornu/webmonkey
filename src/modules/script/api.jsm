/**
 * @fileoverview Implementation of userscript API.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["ScriptApi"];


const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// import dependencies
Cu.import("resource://webmonkey/script/console.jsm");
Cu.import("resource://webmonkey/script/xhr.jsm");
Cu.import("resource://webmonkey/lib/prefs.jsm");

const CONSOLE = Cc["@mozilla.org/consoleservice;1"]
                  .getService(Ci.nsIConsoleService);
const FILE    = Components.stack.filename;


/**
 * Construct a new script API object.
 * @constructor
 * @param script    Parent script.
 *
 * @class   Implementation of the GM script API logic.<br>
 * This class contains the GM_* API methods and the {@link ScriptApi#sandbox}
 * factory method.
 */
ScriptApi = function(/**Script*/ script) {
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

ScriptApi.prototype = {
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
  GM_xmlhttpRequest: function(/**ScriptApiXMLHttpRequest*/ xhr,
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
    var sandbox = new Cu.Sandbox(safeWin);
    sandbox.window       = safeWin;
    sandbox.document     = safeWin.document;
    sandbox.unsafeWindow = unsafeWin;
    sandbox.XPathResult  = Ci.nsIDOMXPathResult;
    // firebug debugging
    sandbox.console      = console ? console : new ScriptApiConsole(this);
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
               new ScriptApiXmlHttpRequest(unsafeWin));
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


/*
 * These functions are added to scripts sandbox so that Firebug's DOM module
 * can properly show the sandbox object hierarchy.
 */
function hasOwnProperty(prop) {
  return prop in this;
}
function __lookupGetter__() { return null; }
function __lookupSetter__() { return null; }

