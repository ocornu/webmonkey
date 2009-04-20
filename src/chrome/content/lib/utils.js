var GM_consoleService = Components.classes["@mozilla.org/consoleservice;1"]
                        .getService(Components.interfaces.nsIConsoleService);

Components.utils.import("resource://webmonkey/prefmanager.js");
Components.utils.import("resource://webmonkey/lib/file.js");

/**
 * Examines the stack to determine if an API should be callable.
 */
function GM_apiLeakCheck(apiName) {
  var stack = Components.stack;

  do {
    // Valid stack frames for GM api calls are: native and js when coming from
    // chrome:// URLs and the greasemonkey.js component's file:// URL.
    if (2 == stack.language) {
      // NOTE: In FF 2.0.0.0, I saw that stack.filename can be null for JS/XPCOM
      // services. This didn't happen in FF 2.0.0.11; I'm not sure when it
      // changed.
      if (stack.filename != null &&
          stack.filename != gmSvcFilename &&
          stack.filename.substr(0, 6) != "chrome") {
        GM_logError(new Error("Webmonkey access violation: unsafeWindow " +
                    "cannot call " + apiName + "."));
        return false;
      }
    }

    stack = stack.caller;
  } while (stack);

  return true;
}

function GM_isDef(thing) {
  return typeof(thing) != "undefined";
}

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

/**
 * Utility to create an error message in the log without throwing an error.
 */
function GM_logError(e, opt_warn, fileName, lineNumber) {
  var consoleService = Components.classes["@mozilla.org/consoleservice;1"]
    .getService(Components.interfaces.nsIConsoleService);

  var consoleError = Components.classes["@mozilla.org/scripterror;1"]
    .createInstance(Components.interfaces.nsIScriptError);

  var flags = opt_warn ? 1 : 0;

  // third parameter "sourceLine" is supposed to be the line, of the source,
  // on which the error happened.  we don't know it. (directly...)
  consoleError.init(e.message, fileName, null, lineNumber,
                    e.columnNumber, flags, null);

  consoleService.logMessage(consoleError);
}

function GM_log(message, force) {
  if (force || GM_prefRoot.get("logChrome", false)) {
    GM_consoleService.logStringMessage(message);
  }
}

function GM_openUserScriptManager() {
  var win = Components.classes["@mozilla.org/appshell/window-mediator;1"]
                      .getService(Components.interfaces.nsIWindowMediator)
                      .getMostRecentWindow("Greasemonkey:Manage");
  if (win) {
    win.focus();
  } else {
    var parentWindow = (!window.opener || window.opener.closed) ?
      window : window.opener;
    parentWindow.openDialog("chrome://webmonkey/content/manage.xul",
      "_blank", "resizable,dialog=no,centerscreen");
  }
}

// TODO: this stuff was copied wholesale and not refactored at all. Lots of
// the UI and Config rely on it. Needs rethinking.

function openInEditor(script) {
  var file = script.editFile;
  var stringBundle = Components
    .classes["@mozilla.org/intl/stringbundle;1"]
    .getService(Components.interfaces.nsIStringBundleService)
    .createBundle("chrome://webmonkey/locale/gm-browser.properties");
  var editor = getEditor(stringBundle);
  if (!editor) {
    // The user did not choose an editor.
    return;
  }

  try {
    launchApplicationWithDoc(editor, file);
  } catch (e) {
    // Something may be wrong with the editor the user selected. Remove so that
    // next time they can pick a different one.
    alert(stringBundle.GetStringFromName("editor.could_not_launch") + "\n" + e);
    GM_prefRoot.remove("editor");
    throw e;
  }
}

function getEditor(stringBundle) {
  var editorPath = GM_prefRoot.get("editor");

  if (editorPath) {
    GM_log("Found saved editor preference: " + editorPath);

    var editor = Components.classes["@mozilla.org/file/local;1"]
                 .createInstance(Components.interfaces.nsILocalFile);
    editor.followLinks = true;
    editor.initWithPath(editorPath);

    // make sure the editor preference is still valid
    if (editor.exists() && editor.isExecutable()) {
      return editor;
    } else {
      GM_log("Editor preference either does not exist or is not executable");
      GM_prefRoot.remove("editor");
    }
  }

  // Ask the user to choose a new editor. Sometimes users get confused and
  // pick a non-executable file, so we set this up in a loop so that if they do
  // that we can give them an error and try again.
  while (true) {
    GM_log("Asking user to choose editor...");
    var nsIFilePicker = Components.interfaces.nsIFilePicker;
    var filePicker = Components.classes["@mozilla.org/filepicker;1"]
                               .createInstance(nsIFilePicker);

    filePicker.init(window, stringBundle.GetStringFromName("editor.prompt"),
                    nsIFilePicker.modeOpen);
    filePicker.appendFilters(nsIFilePicker.filterApplication);
    filePicker.appendFilters(nsIFilePicker.filterAll);

    if (filePicker.show() != nsIFilePicker.returnOK) {
      // The user canceled, return null.
      GM_log("User canceled file picker dialog");
      return null;
    }

    GM_log("User selected: " + filePicker.file.path);

    if (filePicker.file.exists() && filePicker.file.isExecutable()) {
      GM_prefRoot.set("editor", filePicker.file.path);
      return filePicker.file;
    } else {
      alert(stringBundle.GetStringFromName("editor.please_pick_executable"));
    }
  }
}

function launchApplicationWithDoc(appFile, docFile) {
  var args=[docFile.path];

  // For the mac, wrap with a call to "open".
  var xulRuntime = Components.classes["@mozilla.org/xre/app-info;1"]
                             .getService(Components.interfaces.nsIXULRuntime);
  if ("Darwin"==xulRuntime.OS) {
    args=["-a", appFile.path, docFile.path]

    appFile = Components.classes["@mozilla.org/file/local;1"]
                        .createInstance(Components.interfaces.nsILocalFile);
    appFile.followLinks = true;
    appFile.initWithPath("/usr/bin/open");
  }

  var process = Components.classes["@mozilla.org/process/util;1"]
                          .createInstance(Components.interfaces.nsIProcess);
  process.init(appFile);
  process.run(false, args, args.length);
}

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

function ge(id) {
  return window.document.getElementById(id);
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

/*
function GM_isFileScheme(url) {
  var scheme = Components.classes["@mozilla.org/network/io-service;1"]
               .getService(Components.interfaces.nsIIOService)
               .extractScheme(url);

  return scheme == "file";
}
*/

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
