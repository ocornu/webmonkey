/**
 * @fileoverview Implementation of userscript metadata.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["ScriptMetadata"];


const Cu = Components.utils;

// import dependencies
Cu.import("resource://webmonkey/script/require.jsm");
Cu.import("resource://webmonkey/script/resource.jsm");
Cu.import("resource://webmonkey/lib/uriset.jsm");


/**
 * Construct a new script meta-data object.
 * @constructor
 * @param script    Parent script.
 *
 * @class Implementation of scripts meta-data.
 */
ScriptMetadata = function(/**Script*/ script) {
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
   * Script domain (see: <code>&#64;include</code>/<code>&#64;exclude</code>).
   * @type UriSet
   */
  this.domain = new UriSet();
  /**
   * List of <code>&#64;require</code> items.
   * @type ScriptRequire[]
   */
  this.requires = [];
  /**
   * List of <code>&#64;resource</code> items.
   * @type ScriptResource[]
   */
  this.resources = [];
  /**
   * Enabled/disabled state.
   * @type boolean
   * @private
   */
  this._enabled = false;
};

ScriptMetadata.prototype = {
  /**
   * Enabled/disabled state.
   * @type boolean
   */
  get enabled() { return this._enabled; },
  set enabled(enabled) {
    this._enabled = enabled;
    this._script.notify("edit-enabled", enabled);
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
    if (this.domain.addInclude(url))
      this._script.notify("edit-include-add", url);
  },
  /**
   * Remove an include mask.
   * @param index  The index of the include mask to remove.
   */
  removeIncludeAt: function(/**int*/ index) {
    if (this.domain.removeIncludeAt(index))
      this._script.notify("edit-include-remove", index);
  },

  /**
   * Add an exclude mask.
   * @param url     The URL exclude mask to add.
   */
  addExclude: function(/**string*/ url) {
    if (this.domain.addExclude(url))
      this._script.notify("edit-exclude-add", url);
  },
  /**
   * Remove an exclude mask.
   * @param index   The index of the exclude mask to remove.
   */
  removeExcludeAt: function(/**int*/ index) {
    if (this.domain.removeExcludeAt(index))
      this._script.notify("edit-exclude-remove", index);
  },

  /**
   * Find the {@link ScriptResource} with the given resource name.
   * @param aName   The resource name to look for.
   * @return {ScriptResource}  The resource named <code>aName</code>.
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
        this.domain.addInclude(childNode.firstChild.nodeValue);
        break;
      case "Exclude":
        this.domain.addExclude(childNode.firstChild.nodeValue);
        break;
      case "Require":
        this.requires.push(new ScriptRequire(this._script, childNode));
        break;
      case "Resource":
        this.resources.push(new ScriptResource(this._script, childNode));
        break;
      }
  },

  toXml: function(doc, node) {
    node.setAttribute("name", this.name);
    node.setAttribute("namespace", this.namespace);
    node.setAttribute("description", this.description);
    node.setAttribute("enabled", this._enabled);
    for each (var include in this.domain.includes) {
      var includeNode = doc.createElement("Include");
      includeNode.appendChild(doc.createTextNode(include));
      append(includeNode);
    }
    for each (var exclude in this.domain.excludes) {
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
          this.domain.addInclude(value);
          break;
        case "exclude":
          this.domain.addExclude(value);
          break;
        case "require":
          var require = new ScriptRequire(this._script);
          require.parse(value, uri);
          this.requires.push(require);
          break;
        case "resource":
          var resource = new ScriptResource(this._script);
          resource.parse(value, uri);
          this.resources.push(resource);
          break;
        }
    }
    
    // if no meta info, default to reasonable values
    if (this.name == null) this.name = parseScriptName(uri);
    if (this.namespace == null) this.namespace = uri.host;
    if (!this.description) this.description = "";
    if (!this.domain.includes.length) this.domain.addInclude("*");
    this._enabled = true;
  }
};


function parseScriptName(sourceUri) {
  var name = sourceUri.spec;
  name = name.substring(0, name.indexOf(".user.js"));
  return name.substring(name.lastIndexOf("/") + 1);
}

