// JSM exported symbols
var EXPORTED_SYMBOLS = ["Config"];


const GM_GUID = "webmonkey@webmonkey.info";

Components.utils.import("resource://webmonkey/prefmanager.js");
Components.utils.import("resource://webmonkey/script.js");
Components.utils.import("resource://webmonkey/file.js");

/**
 * @class
 */
function Config() {
  this._scripts = null;

  this._scriptDir = File.profile();
  this._scriptDir.name = "scripts";
  if (!this._scriptDir.exists())
    this._scriptDir.create(File.DIR);

  this._configFile = new File(this._scriptDir);
  this._configFile.name = "config.xml";
  if (!this._configFile.exists()) {
    this._configFile.create(File.FILE);
    this._configFile.write("<UserScriptConfig/>");
  }

  this._observers = [];

  this._updateVersion();
  this._loadFromXml();
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
    this._saveToXml();
    this._notifyObservers(script, event, data);
  },

  installIsUpdate: function(script) {
    return this._find(script) > -1;
  },

  _find: function(aScript) {
    var namespace = aScript.meta.namespace.toLowerCase();
    var name = aScript.meta.name.toLowerCase();

    for (var i = 0, script; script = this._scripts[i]; i++) {
      if (script.meta.namespace.toLowerCase() == namespace
        && script.meta.name.toLowerCase() == name) {
        return i;
      }
    }

    return -1;
  },

  _loadFromXml: function() {
    var doc = this._configFile.readXML();
    var nodes = doc.evaluate("/UserScriptConfig/Script", doc, null, 0, null);
    this._scripts = [];
    for (var node; node = nodes.iterateNext();)
      this._scripts.push(Script.fromConfig(this, node));
  },

  _saveToXml: function() {
    var doc = Components.classes["@mozilla.org/xmlextras/domparser;1"]
              .createInstance(Components.interfaces.nsIDOMParser)
              .parseFromString("<UserScriptConfig></UserScriptConfig>",
                               "text/xml");
    var config = doc.firstChild; 
    for each (var script in this._scripts) {
      var scriptNode = script.toXml(doc);
      config.appendChild(doc.createTextNode("\n\t"));
      config.appendChild(scriptNode);
    }
    config.appendChild(doc.createTextNode("\n"));
    this._configFile.writeXML(doc);
  },

  install: function(script) {
//    GM_log("> Config.install");

    var existingIndex = this._find(script);
    if (existingIndex > -1) {
      this.uninstall(this._scripts[existingIndex], false);
    }

    script.install(this);
    this._scripts.push(script);
    this._changed(script, "install", null);

//    GM_log("< Config.install");
  },

  uninstall: function(script, uninstallPrefs) {
    var idx = this._find(script);
    this._scripts.splice(idx, 1);
    this._changed(script, "uninstall", null);

    script._directory.remove(true);

    if (uninstallPrefs) {
      // Remove saved preferences
      GM_prefRoot.remove("scriptvals." + script.meta.namespace + "/" +
                         script.meta.name + ".");
    }
  },

  /**
   * Get the configured text editor. If undefined, ask the user to pick one.
   * @param aParentWindow   The parent window on behalf of which a file picker
   *                        is open.
   * @return {File}         The text editor File.
   */
  getEditor: function(/**nsIDOMWindow*/ aParentWindow) {
    var path = GM_prefRoot.get("editor");
    if (path) {
      var editor = File.path(path, true);
      if (editor.exists() && editor.isExecutable())
        return editor;
      GM_prefRoot.remove("editor");
    }

    // Ask the user to choose a new editor. Sometimes users get confused and
    // pick a non-executable file, so we set this up in a loop so that if they do
    // that we can give them an error and try again.
    while (true) {
      var bundle = Components.classes["@mozilla.org/intl/stringbundle;1"]
                   .getService(Components.interfaces.nsIStringBundleService)
                   .createBundle("chrome://webmonkey/locale/gm-browser.properties");
      var nsIFilePicker = Components.interfaces.nsIFilePicker;
      var filePicker = Components.classes["@mozilla.org/filepicker;1"]
                                 .createInstance(nsIFilePicker);
      filePicker.init(aParentWindow, bundle.GetStringFromName("editor.prompt"),
                      nsIFilePicker.modeOpen);
      if (filePicker.show() != nsIFilePicker.returnOK)
        return null;
      if (filePicker.file.isExecutable()) {
        GM_prefRoot.set("editor", filePicker.file.path);
        return new File(filePicker.file);
      }
      var prompt = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                   .getService(Components.interfaces.nsIPromptService)
      prompt.alert(null, "Webmonkey alert",
                   bundle.GetStringFromName("editor.please_pick_executable"));
    }
  },

  /**
   * Moves an installed user script to a new position in the array of installed scripts.
   *
   * @param script      The script to be moved.
   * @param destination Can be either (a) a numeric offset for the script to be
   *                    moved or (b) another installed script to which position
   *                    the script will be moved.
   */
  move: function(/**Script*/ script, /**int|Script*/ destination) {
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
 * Compares two version numbers.
 * @param aV1   Version of first item in 1.2.3.4..9. format.
 * @param aV2   Version of second item in 1.2.3.4..9. format.
 * @returns {int}  1 if first argument is higher, 0 if arguments are equal,
 *                 -1 if second argument is higher.
 */
function GM_compareVersions(/**string*/ aV1, /**string*/ aV2) {
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
