/**
 * @fileoverview JS Module implementation of the preference manager.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["GM_prefRoot"];

// shortcuts
const Cc = Components.classes;
const Ci = Components.interfaces;


/**
 * Construct a new preference manager.
 * @constructor
 * @param   {string} origin (optional)
 *          The origin of this manager's branch in the main preferences
 *          tree.
 * @throws  <code>Error</code> if <code>origin</code> is not a string.
 *
 * @class   Allow storage and retrieval of (key, value) pairs across tabs,
 *          windows and sessions.
 *          <ul><li>Keys must be of type <code>string</code>. They are organized
 *          in a tree fashion, the leaf/branch separator being a dot (see
 *          <code>about:config</code> for an example).</li>
 *          <li>Values must be of type <code>string</code>, <code>boolean</code>
 *          or integer (<i>i.e.</i> a <code>Number</code> without decimal part,
 *          between {@link #MIN_INT_32} and {@link #MAX_INT_32}).</li></ul>
 *          This simple API sits on top of
 *          <a href="https://developer.mozilla.org/En/NsIPrefBranch">
 *          nsIPrefService</a>.
 */
function PreferenceManager(origin) {
  if (!origin) origin = "";
  else if (typeof origin != "string")
    throw new Error("Origin must be of type 'string'");

  /**
   * The origin of this manager's branch in the preferences tree.
   * @type  string
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
  this._branch = Cc["@mozilla.org/preferences-service;1"]
                 .getService(Ci.nsIPrefService).getBranch(this._origin);

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
PreferenceManager.prototype = {

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
   * Create a new <code>PreferenceManager</code> instance responsible for a
   * subtree of this manager's branch.
   * Will clone the current manager if <code>origin</code> is
   * <code>null/undefined</code>.
   * @param {string} origin (optional)
   *        The origin of the subtree, relatively to this manager's branch.
   * @return    A new preference manager.
   * @type      PreferenceManager
   * @throws    <code>Error</code> if <code>origin</code> is not a string.
   */
  subManager: function(origin) {
    if (!origin) origin = "";
    else if (typeof origin != "string")
      throw new Error("origin must be of type 'string'");
    return new PreferenceManager(this._origin + origin);
  },

  /**
   * Retrieve a stored value.
   * @param {string} key
   *        Key whose value must be retrieved.
   * @param defaultValue (optional)
   *        The default value for this key.
   * @return    The associated value if it exists, else
   *            <code>defaultValue</code> when it has been specified, otherwise
   *            <code>null</code>.
   * @throws    <code>Error</code> if an existing value cannot be parsed.
   */
  get: function(key, defaultValue) {
    if (defaultValue == undefined) defaultValue = null;
    var type = this._branch.getPrefType(key);
    if (type == this._branch.PREF_INVALID) return defaultValue;

    try {
      switch (type) {
      case this._branch.PREF_STRING:
        return this._branch.getCharPref(key);
      case this._branch.PREF_BOOL:
        return this._branch.getBoolPref(key);
      case this._branch.PREF_INT:
        return this._branch.getIntPref(key);
      }
    } catch(e) {}
    throw new Error("Value could not be parsed");
  },

  /**
   * Set a key to the specified value.
   * @param {string} key
   *        Key whose value must be set.
   * @param value
   *        Value for this key. Must be of type <code>string</code>,
   *        <code>boolean</code> or integer (i.e. a <code>Number</code> without
   *        decimal part, between {@link #MIN_INT_32} and {@link #MAX_INT_32}).
   * @return    The stored <code>value</code>.
   * @throws    <code>Error</code> if <code>value</code> has an invalid type.
   */
  set: function(key, value) {
    // assert value has a valid type
    var type = typeof(value);
    var ok = false;
    switch (type) {
    case "string":
    case "boolean":
      ok = true;
      break;
    case "number":
      if (value % 1 == 0 && value >= this.MIN_INT_32 &&
          value <= this.MAX_INT_32)
        ok = true;
      break;
    }
    if (!ok)
      throw new Error("Unsupported value type. Supported types are: " +
                      "string, bool, and 32 bit integers.");

    // underlying preferences object throws an exception if new pref has a
    // different type than old one, so delete old pref first if it is the case.
    if (this.exists(key) && type != typeof(this.get(key)))
      this.remove(key);

    // set new value using correct method
    switch (type) {
    case "string":
      this._branch.setCharPref(key, value);
      break;
    case "boolean":
      this._branch.setBoolPref(key, value);
      break;
    case "number":
      this._branch.setIntPref(key, Math.floor(value));
      break;
    }

    return value;
  },

  /**
   * Whether a key exists.
   * @param {string} key
   *        Key which existence is tested.
   * @return    <code>true</code> if key exists, <code>false</code> otherwise.
   * @type      boolean
   */
  exists: function(key) {
    return this._branch.getPrefType(key) != 0;
  },

  /**
   * Enumerate keys in a subtree.
   * @param {string} origin (optional)
   *        The subtree whose keys must be enumerated. If not set, enumerates
   *        all keys in this manager's branch.
   * @return    The list of keys in the specified subtree.
   * @type      Array
   */
  list: function(origin) {
    if (!origin) origin = "";
    return this._branch.getChildList(origin, {});
  },

  /**
   * Delete a key or subtree.
   * @param {string} origin (optional)
   *        The key or subtree to delete. If not set, deletes all keys of this
   *        manager's branch.
   */
  remove: function(origin) {
    if (!origin) origin = "";
    this._branch.deleteBranch(origin);
  },

  /**
   * Register a handler that will be notified when changes occur in a subtree.
   * @param {string} origin
   *        The origin of the subtree to watch for (may be a single key).
   * @param {Function} handler
   *        The handler to notify for changes. It will be called with one
   *        argument, the name of the key which has changed.
   */
  watch: function(origin, handler) {
    if (typeof handler != "function")
      throw new Error("Handler must be a function");

    // construct an observer
    var observer = {
      observe: function(aSubject, aTopic, aPrefName) {
        handler(aPrefName);
      }
    };
    // store the observer in case we need to remove it later
    this._observers[handler] = observer;

    this._branch.QueryInterface(Ci.nsIPrefBranch2)
                .addObserver(origin, observer, false);
  },

  /**
   * Unregister a subtree changes handler.
   * @param {string} origin
   *        The subtree to stop watching.
   * @param {Function} handler
   *        The handler to remove.
   */
  unwatch: function(origin, handler) {
    if (!this._observers[handler]) return;
    this._branch.QueryInterface(Ci.nsIPrefBranch2)
                .removeObserver(origin, this._observers[handler]);
  }

};


/**
 * Webmonkey root preference manager.
 * @type PreferenceManager
 */
var GM_prefRoot = new PreferenceManager("webmonkey");
