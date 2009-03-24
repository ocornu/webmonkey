// XPCOM info
const CLASSNAME  = "WebmonkeyService";
const CONTRACTID = "@webmonkey.info/webmonkey-service;1";
const CID        = Components.ID("{8d26f120-10b8-11de-8c30-0800200c9a66}");

const Cc = Components.classes;
const Ci = Components.interfaces;

const appSvc = Cc["@mozilla.org/appshell/appShellService;1"]
               .getService(Ci.nsIAppShellService);
const gmSvcFilename = Components.stack.filename;

Components.utils.import("resource://gre/modules/XPCOMUtils.jsm");


//class constructor
function WebmonkeyService() {
  this.wrappedJSObject = this;
}

// class definition
WebmonkeyService.prototype = {
  // properties required for XPCOM registration:
  classDescription:  CLASSNAME,
  classID:           CID,
  contractID:        CONTRACTID,
  _xpcom_categories: [{category: "app-startup",
                       entry: CLASSNAME,
                       value: CONTRACTID,
                       service: true},
                      {category: "content-policy",
                       entry: CONTRACTID,
                       value: CONTRACTID,
                       service: true}],


/***********************************************************
  nsISupports
***********************************************************/
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIObserver,
                                         Ci.nsISupports,
                                         Ci.nsISupportsWeakReference,
                                         Ci.gmIGreasemonkeyService,
                                         Ci.nsIWindowMediatorListener,
                                         Ci.nsIContentPolicy]),


/***********************************************************
  nsIObserver
***********************************************************/
  observe: function(aSubject, aTopic, aData) {
    if (aTopic != "app-startup") return;
    var loader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
                 .getService(Ci.mozIJSSubScriptLoader);
    loader.loadSubScript("chrome://global/content/XPCNativeWrapper.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/prefmanager.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/utils.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/config.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/convert2RegExp.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/miscapis.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/xmlhttprequester.js");
    loader.loadSubScript("chrome://webmonkey/content/utils/updater.js");
  },


/***********************************************************
  gmIGreasemonkeyService
***********************************************************/
  registerBrowser: function(browserWin) {
    for each (var existing in this.browserWindows)
      if (existing == browserWin)
        throw new Error("Browser window has already been registered.");
    this.browserWindows.push(browserWin);

    // Need to wait until well after startup for prefs store and extension
    // manager to be initialized
    if (!this.updater) {
      // Note: the param to this has to match the extension ID in install.rdf
      this.updater = new ExtensionUpdater("webmonkey@webmonkey.info");
      this.updater.updatePeriodically();
    }
  },

  unregisterBrowser: function(browserWin) {
    for each (var existing in this.browserWindows)
      if (existing == browserWin)
        return this.browserWindows.splice(i, 1);
    throw new Error("Browser window is not registered.");
  },

  domContentLoaded: function(wrappedContentWin, chromeWin) {
    var unsafeWin = wrappedContentWin.wrappedJSObject;
    var safeWin   = new XPCNativeWrapper(unsafeWin);
    var href      = safeWin.location.href;
    var scripts   = this.config.getMatchingScripts(
      function(script) { return script.enabled && script.matchesURL(href); }
    );
    // assert there are scripts to inject
    if (!scripts.length) return;

    var firebug   = getFirebugConsole(safeWin, unsafeWin, chromeWin);
    for each (var script in scripts)
      this.inject(script, safeWin, chromeWin, firebug);

    // FireBug 1.2+ console support
    function getFirebugConsole(safeWin, unsafeWin, chromeWin) {
      try {
        chromeWin = chromeWin.top;
        // assert FB is installed
        if (!chromeWin.Firebug)
          return null;
        var fbVersion = parseFloat(chromeWin.Firebug.version);
        var fbConsole = chromeWin.Firebug.Console;
        var fbContext = chromeWin.TabWatcher &&
                        chromeWin.TabWatcher.getContextByWindow(unsafeWin);
        // assert FB is enabled
        if (!fbConsole.isEnabled(fbContext))
          return null;

        if (fbVersion == 1.2) {
          // search console handler
          if (fbContext.consoleHandler)
            for (var i = 0; i < fbContext.consoleHandler.length; i++)
              if (fbContext.consoleHandler[i].window == safeWin)
                return fbContext.consoleHandler[i].handler;
          var dummyElm = safeWin.document.createElement("div");
          dummyElm.setAttribute("id", "_firebugConsole");
          safeWin.document.documentElement.appendChild(dummyElm);
          chromeWin.Firebug.Console.injector.addConsoleListener(fbContext, safeWin);
          dummyElm.parentNode.removeChild(dummyElm);
          return fbContext.consoleHandler.pop().handler;
        }

        if (fbVersion == 1.3 || fbVersion == 1.4) {
          fbConsole.injector.attachIfNeeded(fbContext, unsafeWin);
          // find active context
          for (var i=0; i<fbContext.activeConsoleHandlers.length; i++)
            if (fbContext.activeConsoleHandlers[i].window == unsafeWin)
              return fbContext.activeConsoleHandlers[i];
          return null;
        }
      } catch (e) {
        dump('Webmonkey getFirebugConsole() error:\n'+uneval(e)+'\n');
      }
      return null;
    }
  },


/***********************************************************
  nsIContentPolicy
***********************************************************/
  shouldLoad: function(ct, cl, org, ctx, mt, ext) {
    var ret = Ci.nsIContentPolicy.ACCEPT;

    // block content detection of webmonkey by denying GM
    // chrome content, unless loaded from chrome
    if (org && org.scheme != "chrome" && cl.scheme == "chrome" &&
        cl.host == "webmonkey")
      return Ci.nsIContentPolicy.REJECT_SERVER;

    // don't intercept anything when GM is not enabled
    if (!GM_getEnabled()) return ret;

    // don't interrupt the view-source: scheme
    // (triggered if the link in the error console is clicked)
    if (cl.scheme == "view-source") return ret;

    if (ct == Ci.nsIContentPolicy.TYPE_DOCUMENT && cl.spec.match(/\.user\.js$/)
        && !this._ignoreNextScript && !this.isTempScript(cl)) {
      var winWat = Cc["@mozilla.org/embedcomp/window-watcher;1"]
                   .getService(Ci.nsIWindowWatcher);
      if (winWat.activeWindow && winWat.activeWindow.GM_BrowserUI) {
        winWat.activeWindow.GM_BrowserUI.startInstallScript(cl);
        ret = Ci.nsIContentPolicy.REJECT_REQUEST;
      }
    }

    this._ignoreNextScript = false;
    return ret;

    function isTempScript(uri) {
      if (uri.scheme != "file") return false;
      var file   = Cc["@mozilla.org/network/protocol;1?name=file"]
                   .getService(Ci.nsIFileProtocolHandler)
                   .getFileFromURLSpec(uri.spec);
      var tmpDir = Cc["@mozilla.org/file/directory_service;1"]
                   .getService(Ci.nsIProperties)
                   .get("TmpD", Ci.nsILocalFile);
      return file.parent.equals(tmpDir) && file.leafName != "newscript.user.js";
    }
  },

  shouldProcess: function(ct, cl, org, ctx, mt, ext) {
    return Ci.nsIContentPolicy.ACCEPT;
  },


/***********************************************************
  Other
***********************************************************/
  _config: null,
  get config() {
    if (!this._config)
      this._config = new Config();
    return this._config;
  },

  _ignoreNextScript: false,
  ignoreNextScript: function() {
    dump("ignoring next script...\n");
    this._ignoreNextScript = true;
  },

  browserWindows: [],
  updater: null,

  inject: function(script, safeWin, chromeWin, fbConsole) {
    var sandbox   = new Components.utils.Sandbox(safeWin);
    var logger    = new GM_ScriptLogger(script);
    var console   = fbConsole ? fbConsole : new GM_console(script);
    var storage   = new GM_ScriptStorage(script);
    var unsafeWin = safeWin.wrappedJSObject;
    var xhr       = new GM_xmlhttpRequester(unsafeWin, appSvc.hiddenDOMWindow);
    var resources = new GM_Resources(script);

    // populate sandbox
    sandbox.window       = safeWin;
    sandbox.document     = safeWin.document;
    sandbox.unsafeWindow = unsafeWin;
    sandbox.console      = console;
    sandbox.XPathResult  = Ci.nsIDOMXPathResult;
    // add our own APIs
    var GM = sandbox.GM = {};
    GM.addStyle            = function(css) { GM_addStyle(safeDoc, css) };
    GM.log                 = GM_hitch(logger, "log");
    GM.setValue            = GM_hitch(storage, "setValue");
    GM.getValue            = GM_hitch(storage, "getValue");
    GM.deleteValue         = GM_hitch(storage, "deleteValue");
    GM.listValues          = GM_hitch(storage, "listValues");
    GM.getResourceURL      = GM_hitch(resources, "getResourceURL");
    GM.getResourceText     = GM_hitch(resources, "getResourceText");
    GM.openInTab           = GM_hitch(this, "openInTab", unsafeWin);
    GM.xmlhttpRequest      = GM_hitch(xhr, "contentStartRequest");
    GM.registerMenuCommand = GM_hitch(this, "registerMenuCommand", unsafeWin);
    sandbox.__proto__    = safeWin;

    // compile @requires
    var requires = [];
    var offsets = [];
    var offset = 0;
    for each(var req in script.requires) {
      var contents = req.textContent;
      var lineCount = contents.split("\n").length;
      requires.push(contents);
      offset += lineCount;
      offsets.push(offset);
    }
    script.offsets = offsets;

    // script source (error line-number calculations depend on these \n)
    var source = "\n" + requires.join("\n") + "\n" +
                 script.textContent + "\n";
    var api    = "for (var i in GM) eval('var GM_'+i+' = GM[i]');";
    if (script.unwrap)
      source = api+source;
    else {
      // move API inside script wrapper
      api = "const GM = this.GM; delete this.GM; "+ api +"\
             var window = this.window; delete this.window;\
             var unsafeWindow = this.unsafeWindow; delete this.unsafeWindow;\
             var document = this.document; delete this.document;\
             var XPathResult = this.XPathResult; delete this.XPathResult;\
             var console = this.console; delete this.console;";
      // wrap script into an anonymous function
      source = "(function(){"+ api+source +"})()";
    }

    // eval in sandbox
    try {
      // workaround for https://bugzilla.mozilla.org/show_bug.cgi?id=307984
      var lineRef = new Error().lineNumber + 1;
      Components.utils.evalInSandbox(source, sandbox);
      return true;
    } catch (e) {
      // try to find the line of the actual error line
      if (!e) return false;   // thrown null
      var line = e.lineNumber;
      if (!line || line == 4294967295) { // lineNumber==maxint in edge cases
        if (!e.location || !e.location.lineNumber) {
          GM_logError(e, 0, script.fileURL, 0);
          return false;
        }
        // Sometimes the right one is in "location"
        line = e.location.lineNumber;
      }
      // find problematic file
      line -= lineRef;
      var end, start = 1;
      var uri   = null;
      for (var i in script.offsets) {
        end = script.offsets[i];
        if (line < end) {
          uri = script.requires[i].fileURL;
          break;
        }
        start = end;
      }
      line -= start;
      if (!uri)
        uri = script.fileURL;
      // log error
      GM_logError(e, 0, uri, line);
      return false;
    }
  },

  registerMenuCommand: function(unsafeWin, commandName, commandFunc,
                                accelKey, accelModifiers, accessKey) {
    var command = {name: commandName,
                   accelKey: accelKey,
                   accelModifiers: accelModifiers,
                   accessKey: accessKey,
                   doCommand: commandFunc,
                   window: unsafeWin };
    for (var win in this.browserWindows)
      win.registerMenuCommand(command);
  },

  openInTab: function(unsafeWin, url) {
    var unsafeTop = new XPCNativeWrapper(unsafeWin, "top").top;
    for (var win in this.browserWindows)
      win.openInTab(unsafeTop, url);
  }

};


var components = [WebmonkeyService];
function NSGetModule(compMgr, fileSpec) {
  return XPCOMUtils.generateModule(components);
}
