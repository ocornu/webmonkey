/**
 * @fileoverview Implementation of userscript @resource dependency.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["ScriptResource"];


const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

// import dependencies
Cu.import("resource://webmonkey/script/require.js");
Cu.import("resource://webmonkey/lib/file.js");

const SHELL   = Cc["@mozilla.org/appshell/appShellService;1"]
                   .getService(Ci.nsIAppShellService);


/**
 * Construct a new resource object.
 * @constructor
 * @param script    Parent script.
 * @param [node]    XML node from config file.
 *
 * @class   Implementation of some <code>&#64;resource</code> functionalities.
 * @augments ScriptRequire
 */
ScriptResource = function(/**Script*/ script, /**nsIDOMNode*/ node) {
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

ScriptResource.prototype = {
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

ScriptResource.prototype.__proto__ = ScriptRequire.prototype;

