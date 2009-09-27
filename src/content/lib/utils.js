var GM_consoleService = Components.classes["@mozilla.org/consoleservice;1"]
                        .getService(Components.interfaces.nsIConsoleService);

Components.utils.import("resource://webmonkey/script.jsm");
Components.utils.import("resource://webmonkey/lib/prefs.jsm");
Components.utils.import("resource://webmonkey/lib/file.jsm");

function GM_getConfig() {
  return Components.classes["@webmonkey.info/webmonkey-service;1"]
         .getService().wrappedJSObject.config;
}

function GM_hitch(obj, meth) {
  if (!obj[meth]) {
    throw "method '" + meth + "' does not exist on object '" + obj + "'";
  }

  var staticArgs = Array.prototype.splice.call(arguments, 2, arguments.length);

  return function() {
    // make a copy of staticArgs (don't modify it because it gets reused for
    // every invocation).
    var args = staticArgs.concat();

    // add all the new arguments
    for (var i = 0; i < arguments.length; i++) {
      args.push(arguments[i]);
    }

    // invoke the original function with the correct this obj and the combined
    // list of static and dynamic arguments.
    return obj[meth].apply(obj, args);
  };
}

function GM_listen(source, event, listener, opt_capture) {
  Components.lookupMethod(source, "addEventListener")(
    event, listener, opt_capture);
}

function GM_unlisten(source, event, listener, opt_capture) {
  Components.lookupMethod(source, "removeEventListener")(
    event, listener, opt_capture);
}

function GM_log(message, force) {
  if (force || GM_prefRoot.get("logChrome", false)) {
    GM_consoleService.logStringMessage(message);
  }
}

// TODO: this stuff was copied wholesale and not refactored at all. Lots of
// the UI and Config rely on it. Needs rethinking.

function alert(msg) {
  Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
    .getService(Components.interfaces.nsIPromptService)
    .alert(null, "Webmonkey alert", msg);
}

/**
 * Takes the place of the traditional prompt() function which became broken
 * in FF 1.0.1. :(
 */
function gmPrompt(msg, defVal, title) {
  var promptService = Components.classes["@mozilla.org/embedcomp/prompt-service;1"]
                                .getService(Components.interfaces.nsIPromptService);
  var result = {value:defVal};

  if (promptService.prompt(null, title, msg, result, null, {value:0})) {
    return result.value;
  }
  else {
    return null;
  }
}

function dbg(o) {
  var s = "";
  var i = 0;

  for (var p in o) {
    s += p + ":" + o[p] + "\n";

    if (++i % 15 == 0) {
      alert(s);
      s = "";
    }
  }

  alert(s);
}

function delaydbg(o) {
  setTimeout(function() {dbg(o);}, 1000);
}

function delayalert(s) {
  setTimeout(function() {alert(s);}, 1000);
}

function GM_isGreasemonkeyable(url) {
  var scheme = Components.classes["@mozilla.org/network/io-service;1"]
               .getService(Components.interfaces.nsIIOService)
               .extractScheme(url);

  return (scheme == "http" || scheme == "https" || scheme == "file" ||
          scheme == "ftp" || url.match(/^about:cache/)) &&
          !/hiddenWindow\.html$/.test(url);
}

function GM_getEnabled() {
  return GM_prefRoot.get("enabled", true);
}

function GM_setEnabled(enabled) {
  GM_prefRoot.set("enabled", enabled);
}


/**
 * Logs a message to the console. The message can have python style %s
 * thingers which will be interpolated with additional parameters passed.
 */
function log(message) {
  if (GM_prefRoot.get("logChrome", false)) {
    logf.apply(null, arguments);
  }
}

function logf(message) {
  for (var i = 1; i < arguments.length; i++) {
    message = message.replace(/\%s/, arguments[i]);
  }

  dump(message + "\n");
}

/**
 * Loggifies an object. Every method of the object will have it's entrance,
 * any parameters, any errors, and it's exit logged automatically.
 */
function loggify(obj, name) {
  for (var p in obj) {
    if (typeof obj[p] == "function") {
      obj[p] = gen_loggify_wrapper(obj[p], name, p);
    }
  }
}

function gen_loggify_wrapper(meth, objName, methName) {
  return function() {
     var retVal;
    //var args = new Array(arguments.length);
    var argString = "";
    for (var i = 0; i < arguments.length; i++) {
      //args[i] = arguments[i];
      argString += arguments[i] + (((i+1)<arguments.length)? ", " : "");
    }

    log("> %s.%s(%s)", objName, methName, argString); //args.join(", "));

    try {
      return retVal = meth.apply(this, arguments);
    } finally {
      log("< %s.%s: %s",
          objName,
          methName,
          (typeof retVal == "undefined" ? "void" : retVal));
    }
  }
}
