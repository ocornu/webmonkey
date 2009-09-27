// JSM exported symbols
var EXPORTED_SYMBOLS = ["Config"];


const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;

Cu.import("resource://webmonkey/script.jsm");
Cu.import("resource://webmonkey/lib/prefs.jsm");
Cu.import("resource://webmonkey/lib/file.jsm");

const REPOSITORY_DIR = "userscripts";
const CONFIG_FILE    = "config.xml";


/**
 * @class
 */
function Config() {
  this._scripts = null;

  var dir = File.profile();
  dir.name = REPOSITORY_DIR;
  if (!dir.exists())
    dir.create(File.DIR);
  /**
   * @type File
   */
  this.dir = dir;

  this._observers = [];

  this._loadFromXml();
}

Config.prototype = {
  get _file() {
    var file = new File(this.dir);
    file.name = CONFIG_FILE;
    if (!file.exists()) {
      file.create(File.FILE);
      file.write("<UserScriptConfig/>");
    }
    return file;
  },

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
    var doc = this._file.readXML();
    var nodes = doc.evaluate("/UserScriptConfig/Script", doc, null, 0, null);
    this._scripts = [];
    for (var node; node = nodes.iterateNext();)
      this._scripts.push(Script.fromConfig(this, node));
  },

  _saveToXml: function() {
    var doc = Cc["@mozilla.org/xmlextras/domparser;1"]
              .createInstance(Ci.nsIDOMParser)
              .parseFromString("<UserScriptConfig></UserScriptConfig>",
                               "text/xml");
    var config = doc.firstChild; 
    for each (var script in this._scripts) {
      var scriptNode = script.toXml(doc);
      config.appendChild(doc.createTextNode("\n\t"));
      config.appendChild(scriptNode);
    }
    config.appendChild(doc.createTextNode("\n"));
    this._file.writeXML(doc);
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
      var bundle = Cc["@mozilla.org/intl/stringbundle;1"]
                   .getService(Ci.nsIStringBundleService)
                   .createBundle("chrome://webmonkey/locale/gm-browser.properties");
      var filePicker = Cc["@mozilla.org/filepicker;1"]
                       .createInstance(Ci.nsIFilePicker);
      filePicker.init(aParentWindow, bundle.GetStringFromName("editor.prompt"),
                      Ci.nsIFilePicker.modeOpen);
      if (filePicker.show() != Ci.nsIFilePicker.returnOK)
        return null;
      if (filePicker.file.isExecutable()) {
        GM_prefRoot.set("editor", filePicker.file.path);
        return new File(filePicker.file);
      }
      var prompt = Cc["@mozilla.org/embedcomp/prompt-service;1"]
                   .getService(Ci.nsIPromptService)
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
  getMatchingScripts: function(testFunc) { return this._scripts.filter(testFunc); }
};

