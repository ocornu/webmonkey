/**
 * @fileoverview  URI sets and overlays.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["UriSet"];


const Cc = Components.classes;
const Ci = Components.interfaces;


// import dependencies
Cc["@mozilla.org/moz/jssubscript-loader;1"]
  .getService(Ci.mozIJSSubScriptLoader)
  .loadSubScript("resource://webmonkey/lib/convert2RegExp.js");


/**
 * Construct a new <code>UriSet</code> object.
 * @constructor
 *
 * @class Implementation of an abstract URI set.
 * <p>A URI set is a (potentially infinite) set of URIs.<br>
 * It is specified using a list of include/exclude masks. A target URI that
 * matches an exclude mask is not part of the set; else if it matches an include
 * mask it is part of the set.</p>
 * <p>Masks are URI strings, optionally featuring the wildcard char '*' which
 * stands for "any number of chars".<br>
 * Example: <code>http://www.google.com/*</code></p>
 * <p>For convenience, it is also possible to define a URI set using rules: a
 * rule is a mask, optionally preceded by '-' (exclude) or '+' (include, default).<br>
 * Example: <code>-http://www.google.com/login</code></p>
 * <p>Note: include/exclude masks are unique in their category.</p>
 */
function UriSet() {
  this._init();
}

UriSet.prototype = {
  /**
   * Initializer.
   */
  _init: function() {
    /**
     * Included URI masks.
     * @type UriMask[]
     */
    this._includes = [];
    /**
     * Excluded URI masks.
     * @type UriMask[]
     */
    this._excludes = [];
  },

  get includes() {
    return this._includes.map(UriMask.toString);
  },

  get excludes() {
    return this._excludes.map(UriMask.toString);
  },
  
  /**
   * Add an include mask.
   * @param aMask       The include mask to add.
   * @return {boolean}  <code>true</code> if it was added,
   *                    <code>false</code> otherwise.
   */
  addInclude: function(/**string*/ aMask) {
    return add(this._includes, aMask);
  },
  /**
   * Remove an include mask.
   * @param aMask       The include mask to remove.
   * @return {boolean}  <code>true</code> if it was removed,
   *                    <code>false</code> otherwise.
   */
  removeInclude: function(/**string*/ aMask) {
    return remove(this._includes, aMask);
  },
  /**
   * Remove an include mask.
   * @param aIndex      The include mask index to remove.
   * @return {boolean}  <code>true</code> if it was removed,
   *                    <code>false</code> otherwise.
   * @deprecated
   */
  removeIncludeAt: function(/**int*/ aIndex) {
    return removeAt(this._includes, aIndex);
  },

  /**
   * Add an exclude mask.
   * @param aMask       The exclude mask to add.
   * @return {boolean}  <code>true</code> if it was added,
   *                    <code>false</code> otherwise.
   */
  addExclude: function(/**string*/ aMask) {
    return add(this._excludes, aMask);
  },
  /**
   * Remove an exclude mask.
   * @param aMask       The exclude mask to remove.
   * @return {boolean}  <code>true</code> if it was removed,
   *                    <code>false</code> otherwise.
   */
  removeExclude: function(/**string*/ aMask) {
    return remove(this._excludes, aMask);
  },
  /**
   * Remove an exclude mask.
   * @param aIndex      The exclude mask index to remove.
   * @return {boolean}  <code>true</code> if it was removed,
   *                    <code>false</code> otherwise.
   * @deprecated
   */
  removeExcludeAt: function(/**int*/ aIndex) {
    return removeAt(this._excludes, aIndex);
  },

  /**
   * Add a rule.
   * @param aRule       The rule to add.
   * @return {boolean}  <code>true</code> if it was added,
   *                    <code>false</code> otherwise.
   */
  addRule: function(/**string*/ aRule) {
    var mask = getMask(aRule);
    if (mask=="") return false;
    var target = isInclude(aRule) ? this._includes : this._excludes;
    return add(target, mask);
  },
  /**
   * Remove a rule.
   * @param aRule       The rule to remove.
   * @return {boolean}  <code>true</code> if it was removed,
   *                    <code>false</code> otherwise.
   */
  removeRule: function(/**string*/ aRule) {
    var mask = getMask(aRule);
    if (mask=="") return false;
    var target = isInclude(aRule) ? this._includes : this._excludes;
    return remove(target, mask);
  },
  /**
   * Replace a rule with another.
   * @param oldRule       The rule to be replaced.
   * @param newRule       The rule to put in its place.
   * @return {boolean}  <code>true</code> if it was replaced,
   *                    <code>false</code> otherwise.
   */
  replaceRule: function(/**string*/ oldRule, /**string*/ newRule) {
    var oldMask = getMask(oldRule);
    if (oldMask=="") return false;
    var oldTarget = isInclude(oldRule) ? this._includes : this._excludes;
    var index = indexOf(oldTarget, oldMask);
    if (index<0) return false;

    var newMask = getMask(newRule);
    if (newMask=="") return false;
    var newTarget = isInclude(newRule) ? this._includes : this._excludes;
    if (indexOf(newTarget, newMask)>=0) return false;
    newMask = new UriMask(newMask);

    if (oldTarget==newTarget)
      oldTarget[index] = newMask;
    else {
      oldTarget.splice(oldIndex, 1);
      newTarget.push(newMask);
    }
    return true;
  },

  /**
   * Whether this set contains the specified URI.
   * @param aUri        The URI to test.
   * @return {boolean}  <code>true</code> if it does, <code>false</code> if not.
   */
  contains: function(/**nsIURI|string*/ aUri) {
    if (aUri instanceof Ci.nsIURI)
      aUri = aUri.spec;
    // Do we forbid this URI?
    if (this._excludes.some(match))
      return false;
    // If not, do we allow this URI?
    if (this._includes.some(match))
      return true;
    return false;

    // URI mask tester
    function match(mask) {
      return mask.regexp.test(aUri);
    }
  }
};


/**
 * Construct a new <code>UriMask</code> object.
 * @constructor
 * @param aMask   The string expression of this mask.
 *
 * @class Implementation of a URI mask.
 * @private
 */
function UriMask(/**string*/ aMask) {
  /**
   * String value of this mask.
   * @type string
   */
  this.string = aMask;
  /**
   * Regular expression value of this mask.
   * @type RegExp
   */
  this.regexp = convert2RegExp(aMask);
}
/**
 * @private
 */
UriMask.toString = function(uriMask) { return uriMask.string; };


/**
 * Find the index of a mask in a target list.
 * @param target    The target masks list.
 * @param mask      The mask to find.
 * @return {int}    The index of this mask if it exists in the target list,
 *                  <code>-1</code> otherwise.
 * @private
 */
function indexOf(/**UriMask[]*/ target, /**string*/ mask) {
  for (var i in target)
    if (target[i].string==mask)
      return i;
  return -1;
}

/**
 * Add a mask to a target list, if it does not exist yet.
 * @param target    The target masks list.
 * @param mask      The mask to add.
 * @return {boolean}  <code>true</code> if it was added,
 *                    <code>false</code> otherwise.
 * @private
 */
function add(/**UriMask[]*/ target, /**string*/ mask) {
  if (indexOf(target, mask)>=0) return false;
  target.push(new UriMask(mask));
  return true;
}

/**
 * Remove a mask from a target list, if it does exist.
 * @param target    The target masks list.
 * @param mask      The mask to remove.
 * @return {boolean}  <code>true</code> if it was removed,
 *                    <code>false</code> otherwise.
 * @private
 */
function remove(/**UriMask[]*/ target, /**string*/ mask) {
  var index = indexOf(target, mask);
  if (index<0) return false;
  target.splice(index, 1);
  return true;
}

/**
 * Remove a mask at the specified index in the target list.
 * @param target    The target masks list.
 * @param index     The mask index to remove.
 * @return {boolean}  <code>true</code> if it was removed,
 *                    <code>false</code> otherwise.
 * @private
 * @deprecated
 */
function removeAt(/**UriMask[]*/ target, /**int*/ index) {
  if (!(index>=0 && index<target.length)) return false;
  target.splice(index, 1);
  return true;
}

/**
 * Whether the specified rule is an include rule.
 * @param rule        The rule to test.
 * @return {boolean}  <code>true</code> if it's an include,
 *                    <code>false</code> otherwise.
 * @private
 */
function isInclude(/**string*/ rule) {
  return /^\s*[^-]/.test(rule);
}

/**
 * Extract the string mask contained in this rule.
 * @param rule        The rule to extract a mask from.
 * @return {string}   The included mask if there is any,
 *                    <code>""</code> otherwise.
 * @private
 */
function getMask(/**string*/ rule) {
  if (typeof rule != "string") return "";
  return rule.replace(/^\s*(\+|-)?\s*(.*)\s*$/, "$2");
}

