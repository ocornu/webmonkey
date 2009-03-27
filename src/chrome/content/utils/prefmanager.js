/**
 * Construct a new preference manager.
 * @constructor
 * @param   {String} origin (optional)
 *          The origin of this manager's branch in the main preferences
 *          tree.
 * @throws  <code>Error</code> if <code>origin</code> is not a string.
 *
 * @class   Allow storage and retrieval of <code>(key, value)</code> pairs
 *          across tabs, windows and sessions.
 *          This simple API sits on top of <code>nsIPrefService</code>.
 */
function GM_PrefManager(origin) {
  if (!origin) origin = "";
  else if (typeof origin != "string")
    throw new Error("Origin must be of type 'string'");

  /**
   * The origin of this manager's branch in the preferences tree.
   * @type  String
   * @private
   * @final
   */
  this._origin = origin + (origin.length ? "." : "");

  /**
   * The preferences branch for this manager.
   * @type nsIPrefBranch
   * @private
   * @final
   */
  this._branch = Components.classes["@mozilla.org/preferences-service;1"]
                           .getService(Components.interfaces.nsIPrefService)
                           .getBranch(this._origin);

  /**
   * A dictionary of registered observers for this manager's preferences.
   * @private
   * @final
   */
  this._observers = {};
}


/*
 * Prototype
 */
GM_PrefManager.prototype = {

  /**
   * Minimum integer value (32 bits).
   * @type Number
   * @final
   */
  MIN_INT_32: -0x80000000,
  /**
   * Maximum integer value (32 bits).
   * @type Number
   * @final
   */
  MAX_INT_32: 0x7FFFFFFF,

  /**
   * Create a new <code>GM_PrefManager</code> instance responsible for a subtree
   * of this manager's branch.
   * Will clone the current manager if <code>origin</code> is
   * <code>null/undefined</code>.
   * @param {String} origin (optional)
   *        The origin of the subtree, relatively to this manager's branch.
   * @return    A new preference manager.
   * @type      GM_PrefManager
   * @throws    <code>Error</code> if <code>origin</code> is not a string.
   */
  subManager: function(origin) {
    if (!origin) origin = "";
    else if (typeof origin != "string")
      throw new Error("origin must be of type 'string'");
    return new GM_PrefManager(this._origin + origin);
  },

  /**
   * Whether a preference exists.
   * @param {String} prefName
   *        Target preference name.
   * @return    <code>true</code> if preference exists, <code>false</code>
   *            otherwise.
   * @type      Boolean
   */
  exists: function(prefName) {
    return this._branch.getPrefType(prefName) != 0;
  },

  /**
   * Enumerate preferences.
   * @return    The names of all stored preferences
   * @type      Array
   */
  listValues: function() {
    return this._branch.getChildList("", {});
  },

  /**
   * Retrieve a stored preference.
   * @param {String} prefName
   *        Name of the preference to retrieve.
   * @param defaultValue
   *        The default value for this preference (optional)
   * @return    The named preference value if it exists, else
   *            <code>defaultValue</code> when specified, otherwise
   *            <code>null</code>.
   */
  getValue: function(prefName, defaultValue) {
    if (defaultValue == undefined) defaultValue = null;
    var prefType = this._branch.getPrefType(prefName);
    if (prefType == this._branch.PREF_INVALID) return defaultValue;

    try {
      switch (prefType) {
        case this._branch.PREF_STRING:
          return this._branch.getComplexValue(prefName,
                 Components.interfaces.nsISupportsString).data;
        case this._branch.PREF_BOOL:
          return this._branch.getBoolPref(prefName);
        case this._branch.PREF_INT:
          return this._branch.getIntPref(prefName);
      }
    } catch(ex) {}

    return defaultValue;
  },

  /**
   * Set the named preference to the specified value.
   * @param {String} prefName
   *        Name of the preference to set.
   * @param value
   *        Value for this preference. Must be of type <code>String</code>,
   *        <code>Boolean</code> or integer (a <code>Number</code> without
   *        decimal part, between {@link #MIN_INT_32} and {@link #MAX_INT_32}).
   */
  setValue: function(prefName, value) {
    // assert value has a valid type
    var prefType = typeof(value);
    var goodType = false;
    switch (prefType) {
      case "string":
      case "boolean":
        goodType = true;
        break;
      case "number":
        if (value % 1 == 0 && value >= this.MIN_INT_32 &&
            value <= this.MAX_INT_32)
          goodType = true;
        break;
    }
    if (!goodType)
      throw new Error("Unsupported type for GM_setValue. Supported types " +
                      "are: string, bool, and 32 bit integers.");

    // underlying preferences object throws an exception if new pref has a
    // different type than old one. i think we should not do this, so delete
    // old pref first if this is the case.
    if (this.exists(prefName) && prefType != typeof(this.getValue(prefName)))
      this.remove(prefName);

    // set new value using correct method
    switch (prefType) {
      case "string":
        var str = Components.classes["@mozilla.org/supports-string;1"]
                  .createInstance(Components.interfaces.nsISupportsString);
        str.data = value;
        this._branch.setComplexValue(prefName,
                     Components.interfaces.nsISupportsString, str);
        break;
      case "boolean":
        this._branch.setBoolPref(prefName, value);
        break;
      case "number":
        this._branch.setIntPref(prefName, Math.floor(value));
        break;
    }
  },

  /**
   * Delete the named preference or subtree.
   * @param {String} prefName
   *        The name of the preference or subtree to delete.
   */
  remove: function(prefName) {
    this._branch.deleteBranch(prefName);
  },

  /**
   * Register a handler that will be notified whenever the named preference or
   * subtree changes.
   * @param {String} prefName
   *        The name of the preference or subtree to watch.
   * @param {Function} watcher
   *        The handler to notify for changes. It will be called with one
   *        argument, the name of the preference or subtree that has changed. 
   */
  watch: function(prefName, watcher) {
    if (!watcher || typeof watcher != "function")
      throw new Error("Watcher must be a function");

    // construct an observer
    var observer = {
      observe:function(subject, topic, prefName) {
        watcher(prefName);
      }
    };
    // store the observer in case we need to remove it later
    this._observers[watcher] = observer;

    this._branch.QueryInterface(Components.interfaces.nsIPrefBranch2)
                .addObserver(prefName, observer, false);
  },

  /**
   * Unregister a preference changes handler.
   * @param {String} prefName
   *        The name of the preference or subtree to stop watching.
   * @param {Function} watcher
   *        The handler to remove.
   */
  unwatch: function(prefName, watcher) {
    if (!this._observers[watcher]) return;
    this._branch.QueryInterface(Components.interfaces.nsIPrefBranch2)
                .removeObserver(prefName, this._observers[watcher]);
  }

};


var GM_prefRoot = new GM_PrefManager("webmonkey");
