var GM_prefRoot = new GM_PrefManager();

GM_PrefManager.MIN_INT_32 = -0x80000000;
GM_PrefManager.MAX_INT_32 = 0x7FFFFFFF;

/**
 * Construct a new preference manager.
 * <code>"webmonkey."</code> prefix is assumed.
 * @constructor
 * @param   {String} startPoint
 *          The starting point in the preferences tree for this manager subtree.
 *
 * @class   Simple API on top of <code>nsIPrefService</code> for Webmonkey.
 */
function GM_PrefManager(startPoint) {
  if (!startPoint) {
    startPoint = "";
  }

  startPoint = "webmonkey." + startPoint;

  var pref = Components.classes["@mozilla.org/preferences-service;1"]
                       .getService(Components.interfaces.nsIPrefService)
                       .getBranch(startPoint);

  var observers = {};
  const nsISupportsString = Components.interfaces.nsISupportsString;

  /**
   * Whether a preference exists.
   * @param {String} prefName
   *        Target preference name.
   * @return    <code>true</code> if preference exists, <code>false</code>
   *            otherwise.
   * @type      Boolean
   */
  this.exists = function(prefName) {
    return pref.getPrefType(prefName) != 0;
  };

  /**
   * Enumerate preferences.
   * @return    The names of all stored preferences
   * @type      Array
   */
  this.listValues = function() {
    return pref.getChildList("", {});
  }

  /**
   * Retrieve a stored preference.
   * @param {String} prefName
   *        Name of the preference to retrieve.
   * @param defaultValue
   *        The default value for this preference (optional)
   * @return    The named preference value if it exists, otherwise
   *            <code>defaultValue</code> when specified, else
   *            <code>undefined</code>.
   */
  this.getValue = function(prefName, defaultValue) {
    var prefType = pref.getPrefType(prefName);

    // underlying preferences object throws an exception if pref doesn't exist
    if (prefType == pref.PREF_INVALID) {
      return defaultValue;
    }

    try {
      switch (prefType) {
        case pref.PREF_STRING:
          return pref.getComplexValue(prefName, nsISupportsString).data;
        case pref.PREF_BOOL:
          return pref.getBoolPref(prefName);
        case pref.PREF_INT:
          return pref.getIntPref(prefName);
      }
    } catch(ex) {
      return defaultValue != undefined ? defaultValue : null;
    }
    return null;
  };

  /**
   * Set the named preference to the specified value.
   * @param {String} prefName
   *        Name of the preference to set.
   * @param value
   *        Value for this preference. Must be of type <code>String</code>,
   *        <code>Boolean</code> or integer (a <code>Number</code> without
   *        decimal part, between {@link #MIN_INT_32} and {@link #MAX_INT_32}).
   */
  this.setValue = function(prefName, value) {
    var prefType = typeof(value);
    var goodType = false;

    switch (prefType) {
      case "string":
      case "boolean":
        goodType = true;
        break;
      case "number":
        if (value % 1 == 0 &&
            value >= GM_PrefManager.MIN_INT_32 &&
            value <= GM_PrefManager.MAX_INT_32) {
          goodType = true;
        }
        break;
    }

    if (!goodType) {
      throw new Error("Unsupported type for GM_setValue. Supported types " +
                      "are: string, bool, and 32 bit integers.");
    }

    // underlying preferences object throws an exception if new pref has a
    // different type than old one. i think we should not do this, so delete
    // old pref first if this is the case.
    if (this.exists(prefName) && prefType != typeof(this.getValue(prefName))) {
      this.remove(prefName);
    }

    // set new value using correct method
    switch (prefType) {
      case "string":
        var str = Components.classes["@mozilla.org/supports-string;1"]
                            .createInstance(nsISupportsString);
        str.data = value;
        pref.setComplexValue(prefName, nsISupportsString, str);
        break;
      case "boolean":
        pref.setBoolPref(prefName, value);
        break;
      case "number":
        pref.setIntPref(prefName, Math.floor(value));
        break;
    }
  };

  /**
   * Delete the named preference or subtree.
   * @param {String} prefName
   *        The name of the preference or subtree to delete.
   */
  this.remove = function(prefName) {
    pref.deleteBranch(prefName);
  };

  /**
   * Register a handler that will be notified whenever the named preference or
   * subtree changes.
   * @param {String} prefName
   *        The name of the preference or subtree to watch.
   * @param {Function} watcher
   *        The handler to notify for changes. It will be called with one
   *        argument, the name of the preference or subtree that has changed. 
   */
  this.watch = function(prefName, watcher) {
    // construct an observer
    var observer = {
      observe:function(subject, topic, prefName) {
        watcher(prefName);
      }
    };

    // store the observer in case we need to remove it later
    observers[watcher] = observer;

    pref.QueryInterface(Components.interfaces.nsIPrefBranch2).
      addObserver(prefName, observer, false);
  };

  /**
   * Unregister a preference changes handler.
   * @param {String} prefName
   *        The name of the preference or subtree to stop watching.
   * @param {Function} watcher
   *        The handler to remove.
   */
  this.unwatch = function(prefName, watcher) {
    if (observers[watcher]) {
      pref.QueryInterface(Components.interfaces.nsIPrefBranch2).
        removeObserver(prefName, observers[watcher]);
    }
  };
}
