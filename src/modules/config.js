// JSM exported symbols
var EXPORTED_SYMBOLS = ["Config"];


const GM_GUID = "webmonkey@webmonkey.info";

Components.utils.import("resource://webmonkey/prefmanager.js");
Components.utils.import("resource://webmonkey/script.js");
Components.utils.import("resource://webmonkey/lib/file.js");


function Config() {
  this._scripts = null;

  this._scriptDir = File.profile();
  this._scriptDir.name = "scripts";
  if (!this._scriptDir.exists())
    this._scriptDir.create(File.DIRECTORY);

  this._configFile = new File(this._scriptDir);
  this._configFile.name = "config.xml";
  if (!this._configFile.exists()) {
    this._configFile.create(File.FILE);
    this._configFile.write("<UserScriptConfig/>");
  }

  this._observers = [];

  this._updateVersion();
  this._load();
}

Config.prototype = {
  addObserver: function(observer, script) {
    var observers = script ? script._observers : this._observers;
    observers.push(observer);
  },

  removeObserver: function(observer, script) {
    var observers = script ? script._observers : this._observers;
    var index = observers.indexOf(observer);
    if (index == -1) throw new Error("Observer not found");
    observers.splice(index, 1);
  },

  _notifyObservers: function(script, event, data) {
    var observers = this._observers.concat(script._observers);
    for (var i = 0, observer; observer = observers[i]; i++) {
      observer.notifyEvent(script, event, data);
    }
  },

  _changed: function(script, event, data) {
    this._save();
    this._notifyObservers(script, event, data);
  },

  installIsUpdate: function(script) {
    return this._find(script) > -1;
  },

  _find: function(aScript) {
    namespace = aScript._namespace.toLowerCase();
    name = aScript._name.toLowerCase();

    for (var i = 0, script; script = this._scripts[i]; i++) {
      if (script._namespace.toLowerCase() == namespace
        && script._name.toLowerCase() == name) {
        return i;
      }
    }

    return -1;
  },

  _load: function() {
    var doc = this._configFile.readXML();
    var nodes = doc.evaluate("/UserScriptConfig/Script", doc, null, 0, null);
    this._scripts = [];
    for (var node; node = nodes.iterateNext();)
      this._scripts.push(new Script(this).load(node));
  },

  _save: function() {
    var doc = Components.classes["@mozilla.org/xmlextras/domparser;1"]
              .createInstance(Components.interfaces.nsIDOMParser)
              .parseFromString("<UserScriptConfig></UserScriptConfig>",
                               "text/xml");
    var config = doc.firstChild; 
    for each (var script in this._scripts) {
      var scriptNode = script.save(doc);
      config.appendChild(doc.createTextNode("\n\t"));
      config.appendChild(scriptNode);
    }
    config.appendChild(doc.createTextNode("\n"));
    this._configFile.writeXML(doc);
  },

  parse: function(source, uri) {
    var ioservice = Components.classes["@mozilla.org/network/io-service;1"]
                              .getService(Components.interfaces.nsIIOService);

    var script = new Script(this);
    script._downloadURL = uri.spec;
    script._enabled = true;

    // read one line at a time looking for start meta delimiter or EOF
    var lines = source.match(/.+/g);
    var lnIdx = 0;
    var result = {};
    var foundMeta = false;

    while ((result = lines[lnIdx++])) {
      if (result.indexOf("// ==UserScript==") == 0) {
        foundMeta = true;
        break;
      }
    }

    // gather up meta lines
    if (foundMeta) {
      // used for duplicate resource name detection
      var previousResourceNames = {};

      while ((result = lines[lnIdx++])) {
        if (result.indexOf("// ==/UserScript==") == 0) {
          break;
        }

        var match = result.match(/\/\/ \@(\S+)(?:\s+([^\n]+))?/);
        if (match === null) continue;

        var header = match[1];
        var value = match[2];
        if (value) { // @header <value>
          switch (header) {
            case "name":
            case "namespace":
            case "description":
              script["_" + header] = value;
              break;
            case "include":
              script._includes.push(value);
              break;
            case "exclude":
              script._excludes.push(value);
              break;
            case "require":
              var reqUri = ioservice.newURI(value, null, uri);
              var scriptRequire = new ScriptRequire(script);
              scriptRequire._downloadURL = reqUri.spec;
              script._requires.push(scriptRequire);
              break;
            case "resource":
              var res = value.match(/(\S+)\s+(.*)/);
              if (res === null) {
                // NOTE: Unlocalized strings
                throw new Error("Invalid syntax for @resource declaration '" +
                                value + "'. Resources are declared like: " +
                                "@resource <name> <url>.");
              }

              var resName = res[1];
              if (previousResourceNames[resName]) {
                throw new Error("Duplicate resource name '" + resName + "' " +
                                "detected. Each resource must have a unique " +
                                "name.");
              } else {
                previousResourceNames[resName] = true;
              }

              var resUri = ioservice.newURI(res[2], null, uri);
              var scriptResource = new ScriptResource(script);
              scriptResource._name = resName;
              scriptResource._downloadURL = resUri.spec;
              script._resources.push(scriptResource);
              break;
          }
        } else { // plain @header
          switch (header) {
            case "unwrap":
              script._unwrap = true;
              break;
          }
        }
      }
    }

    // if no meta info, default to reasonable values
    if (script._name == null) script._name = parseScriptName(uri);
    if (script._namespace == null) script._namespace = uri.host;
    if (!script._description) script._description = "";
    if (script._includes.length == 0) script._includes.push("*");

    return script;
  },

  install: function(script) {
//    GM_log("> Config.install");

    var existingIndex = this._find(script);
    if (existingIndex > -1) {
      this.uninstall(this._scripts[existingIndex], false);
    }

    script._initFile(script._tempFile);
    script._tempFile = null;

    for (var i = 0; i < script._requires.length; i++) {
      script._requires[i]._initFile();
    }

    for (var i = 0; i < script._resources.length; i++) {
      script._resources[i]._initFile();
    }

    this._scripts.push(script);
    this._changed(script, "install", null);

//    GM_log("< Config.install");
  },

  uninstall: function(script, uninstallPrefs) {
    var idx = this._find(script);
    this._scripts.splice(idx, 1);
    this._changed(script, "uninstall", null);

    script._basedirFile.remove(true);

    if (uninstallPrefs) {
      // Remove saved preferences
      GM_prefRoot.remove("scriptvals." + script._namespace + "/" + script._name + ".");
    }
  },

  /**
   * Moves an installed user script to a new position in the array of installed scripts.
   *
   * @param script The script to be moved.
   * @param destination Can be either (a) a numeric offset for the script to be
   *                    moved or (b) another installet script to which position
   *                    the script will be moved.
   */
  move: function(script, destination) {
    var from = this._scripts.indexOf(script);
    var to = -1;

    // Make sure the user script is installed
    if (from == -1) return;

    if (typeof destination == "number") { // if destination is an offset
      to = from + destination;
      to = Math.max(0, to);
      to = Math.min(this._scripts.length - 1, to);
    } else { // if destination is a script object
      to = this._scripts.indexOf(destination);
    }

    if (to == -1) return;

    var tmp = this._scripts.splice(from, 1)[0];
    this._scripts.splice(to, 0, tmp);
    this._changed(script, "move", to);
  },

  get scripts() { return this._scripts.concat(); },
  getMatchingScripts: function(testFunc) { return this._scripts.filter(testFunc); },

  /**
   * Checks whether the version has changed since the last run and performs
   * any necessary upgrades.
   */
  _updateVersion: function() {
//    log("> GM_updateVersion");

    // this is the last version which has been run at least once
    var initialized = GM_prefRoot.get("version", "0.0");

    // update the currently initialized version so we don't do this work again.
    var extMan = Components.classes["@mozilla.org/extensions/manager;1"]
      .getService(Components.interfaces.nsIExtensionManager);

    var item = extMan.getItemForID(GM_GUID);
    GM_prefRoot.set("version", item.version);

//    log("< GM_updateVersion");
  }

};


/**
 * Compares two version numbers
 * @param {String} aV1
 *        Version of first item in 1.2.3.4..9. format
 * @param {String} aV2
 *        Version of second item in 1.2.3.4..9. format
 * @returns {Int}  1 if first argument is higher
 *                 0 if arguments are equal
 *                 -1 if second argument is higher
 */
function GM_compareVersions(aV1, aV2) {
  var v1 = aV1.split(".");
  var v2 = aV2.split(".");
  var numSubversions = (v1.length > v2.length) ? v1.length : v2.length;

  for (var i = 0; i < numSubversions; i++) {
    if (typeof v2[i] == "undefined") {
      return 1;
    }

    if (typeof v1[i] == "undefined") {
      return -1;
    }

    if (parseInt(v2[i], 10) > parseInt(v1[i], 10)) {
      return -1;
    } else if (parseInt(v2[i], 10) < parseInt(v1[i], 10)) {
      return 1;
    }
  }

  // v2 was never higher or lower than v1
  return 0;
}
