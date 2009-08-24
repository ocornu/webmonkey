// this file is the JavaScript backing for the UI wrangling which happens in
// browser.xul. It also initializes the Greasemonkey singleton which contains
// all the main injection logic, though that should probably be a proper XPCOM
// service and wouldn't need to be initialized in that case.
/**
 * @namespace
 */
var GM_BrowserUI = new Object();

/**
 * nsISupports.QueryInterface
 */
GM_BrowserUI.QueryInterface = function(aIID) {
  if (!aIID.equals(Components.interfaces.nsISupports) &&
      !aIID.equals(Components.interfaces.nsISupportsWeakReference) &&
      !aIID.equals(Components.interfaces.nsIWebProgressListener))
    throw Components.results.NS_ERROR_NO_INTERFACE;

  return this;
};


/**
 * Called when this file is parsed, by the last line. Set up initial objects,
 * do version checking, and set up listeners for browser xul load and location
 * changes.
 */
GM_BrowserUI.init = function() {
  this.menuCommanders = [];
  this.currentMenuCommander = null;

  GM_listen(window, "load", GM_hitch(this, "chromeLoad"));
  GM_listen(window, "unload", GM_hitch(this, "chromeUnload"));
};

/**
 * The browser XUL has loaded. Find the elements we need and set up our
 * listeners and wrapper objects.
 */
GM_BrowserUI.chromeLoad = function(e) {
  // get all required DOM elements
  this.tabBrowser = document.getElementById("content");
  this.appContent = document.getElementById("appcontent");
  this.contextMenu = document.getElementById("contentAreaContextMenu");
  this.statusImage = document.getElementById("gm-status-image");
  this.statusLabel = document.getElementById("gm-status-label");
  this.statusPopup = document.getElementById("gm-status-popup");
  this.statusEnabledItem = document.getElementById("gm-status-enabled-item");
  this.generalMenuEnabledItem = document.getElementById("gm-general-menu-enabled-item");
  this.toolsMenu = document.getElementById("menu_ToolsPopup");
  this.bundle = document.getElementById("gm-browser-bundle");

  // seamonkey compat
  if (!this.toolsMenu) {
    this.toolsMenu = document.getElementById("taskPopup");
  }

  // songbird compat
  if (!this.appContent && this.tabBrowser) {
    this.appContent = this.tabBrowser.parentNode;
  }

  // update visual status when enabled state changes
  this.enabledWatcher = GM_hitch(this, "refreshStatus");
  GM_prefRoot.watch("enabled", this.enabledWatcher);

  // hook various events
  GM_listen(this.appContent, "DOMContentLoaded", GM_hitch(this, "contentLoad"));
  GM_listen(this.contextMenu, "popupshowing", GM_hitch(this, "contextMenuShowing"));
  GM_listen(this.toolsMenu, "popupshowing", GM_hitch(this, "toolsMenuShowing"));

  // listen for clicks on the install bar
  Components.classes["@mozilla.org/observer-service;1"]
            .getService(Components.interfaces.nsIObserverService)
            .addObserver(this, "install-userscript", true);

  // we use this to determine if we are the active window sometimes
  this.winWat = Components.classes["@mozilla.org/embedcomp/window-watcher;1"]
                          .getService(Components.interfaces.nsIWindowWatcher);

  // this gives us onLocationChange
  this.tabBrowser.addProgressListener(this,
    Components.interfaces.nsIWebProgress.NOTIFY_LOCATION);

  // update enabled icon
  this.refreshStatus();

  // register for notifications from greasemonkey-service about ui type things
  this.gmSvc = Components.classes["@webmonkey.info/webmonkey-service;1"]
               .getService().wrappedJSObject;
};

/**
 * Gets called when a DOMContentLoaded event occurs somewhere in the browser.
 * If that document is in in the top-level window of the focused tab, find
 * it's menu items and activate them.
 */
GM_BrowserUI.contentLoad = function(e) {
  var safeWin;
  var unsafeWin;
  var href;
  var commander;

  if (!GM_getEnabled()) {
    return;
  }

  safeWin = e.target.defaultView;
  unsafeWin = safeWin.wrappedJSObject;
  href = safeWin.location.href;

  if (GM_isGreasemonkeyable(href)) {
    commander = this.getCommander(unsafeWin);

    // if this content load is in the focused tab, attach the menuCommaander
    if (unsafeWin == this.tabBrowser.selectedBrowser.contentWindow) {
      this.currentMenuCommander = commander;
      this.currentMenuCommander.attach();
    }

    this.gmSvc.domContentLoaded(unsafeWin, window, this);

    GM_listen(unsafeWin, "pagehide", GM_hitch(this, "contentUnload"));
  }

  // Show the greasemonkey install banner if we are navigating to a .user.js
  // file in a top-level tab.
  if (href.match(/\.user\.js$/) && safeWin == safeWin.top) {
    var browser = this.tabBrowser.getBrowserForDocument(safeWin.document);
    this.showInstallBanner(browser);
  }
};


/**
 * Shows the install banner across the top of the tab that is displayed when
 * a user selects "show script source" in the install dialog.
 */
GM_BrowserUI.showInstallBanner = function(browser) {
  var greeting = this.bundle.getString("greeting.msg");

  if (this.tabBrowser.showMessage) {
    // Firefox 1.5 and lower
    this.tabBrowser.showMessage(
      browser,
      "chrome://webmonkey/content/icons/icon_small.png",
      greeting,
      this.bundle.getString("greeting.btn"),
      null /* default doc shell */,
      "install-userscript",
      null /* no popuup */,
      "top",
      true /* show close button */,
      this.bundle.getString("greeting.btnAccess") /* access key */);
  } else {
    // Firefox 2.0+
    var notificationBox = this.tabBrowser.getNotificationBox(browser);

    // Remove existing notifications. Notifications get removed
    // automatically onclick and on page navigation, but we need to remove
    // them ourselves in the case of reload, or they stack up.
    for (var i = 0, child; child = notificationBox.childNodes[i]; i++) {
      if (child.getAttribute("value") == "install-userscript") {
        notificationBox.removeNotification(child);
      }
    }

    var notification = notificationBox.appendNotification(
      greeting,
      "install-userscript",
      "chrome://webmonkey/content/icons/icon_small.png",
      notificationBox.PRIORITY_WARNING_MEDIUM,
      [{
        label: this.bundle.getString("greeting.btn"),
        accessKey: this.bundle.getString("greeting.btnAccess"),
        popup: null,
        callback: GM_hitch(this, "installCurrentScript")
      }]
    );
  }
};

/**
 * Called from greasemonkey service when we should load a user script.
 */
GM_BrowserUI.downloadScript = function(/**nsIURI*/ uri, /**boolean*/ install) {
  this.statusImage.src = "chrome://global/skin/throbber/Throbber-small.gif";
  this.statusImage.style.opacity = "0.5";
  this.statusImage.tooltipText = this.bundle.getString("tooltip.loading");
  this.showStatus("Fetching user script", false);
  Script.fromUri(uri,
    function(script) {
      GM_BrowserUI.refreshStatus();
      GM_BrowserUI.hideStatusImmediately();
      if (install)
        GM_BrowserUI.showInstallDialog(script);
      else
        GM_BrowserUI.showScriptView(script);
    },
    function(source, status, statusText) {
      window.alert("Could not download script:\n"
                   + uri.spec + "\n\n"
                   + "Error "+ status + " (" + statusText +")\n");
    },
    true);
};

GM_BrowserUI.showInstallDialog = function(script, timer) {
  if (!timer) {
    // otherwise, the status bar stays in the loading state.
    window.setTimeout(GM_hitch(this, "showInstallDialog", script, true), 0);
    return;
  }
  window.openDialog("chrome://webmonkey/content/install.xul", "",
                    "chrome,centerscreen,modal,dialog,titlebar,resizable",
                    this, script);
};

/**
 * Open the tab to show the contents of a script and display the banner to let
 * the user install it.
 */
GM_BrowserUI.showScriptView = function(script) {
  var tab = this.tabBrowser.addTab(script.previewURL);
  tab.script = script;
//  var browser = this.tabBrowser.getBrowserForTab(tab);
  this.tabBrowser.selectedTab = tab;
};

/**
 * Implements nsIObserve.observe. Right now we're only observing our own
 * install-userscript, which happens when the install bar is clicked.
 */
GM_BrowserUI.observe = function(subject, topic, data) {
  if (topic == "install-userscript") {
    if (window == this.winWat.activeWindow) {
      this.installCurrentScript();
    }
  } else {
    throw new Error("Unexpected topic received: {" + topic + "}");
  }
};

/**
 * Handles the install button getting clicked.
 */
GM_BrowserUI.installCurrentScript = function() {
  var tab = this.tabBrowser.selectedTab;
  if (!tab.script) return;
  this.installScript(tab.script);
  tab.script = null;
};

GM_BrowserUI.installScript = function(script){
  this.statusImage.src = "chrome://global/skin/throbber/Throbber-small.gif";
  this.statusImage.style.opacity = "0.5";
//  this.statusImage.tooltipText = this.bundle.getString("tooltip.loading");
  this.showStatus("Fetching script dependencies", false);
  script.fetchDeps(
    function(script) {
      GM_BrowserUI.refreshStatus();
      GM_BrowserUI.hideStatusImmediately();
      GM_getConfig().install(script);
      GM_BrowserUI.showHorrayMessage(script.name);
    },
    function(source, status, statusText) {
      GM_BrowserUI.refreshStatus();
      GM_BrowserUI.hideStatusImmediately();
      alert("Error");
    });
};

/**
 * The browser's location has changed. Usually, we don't care. But in the case
 * of tab switching we need to change the list of commands displayed in the
 * User Script Commands submenu.
 */
GM_BrowserUI.onLocationChange = function(a,b,c) {
  if (this.currentMenuCommander != null) {
    this.currentMenuCommander.detach();
    this.currentMenuCommander = null;
  }

  var menuCommander = this.getCommander(this.tabBrowser.selectedBrowser.
                                        contentWindow);

  if (menuCommander) {
    this.currentMenuCommander = menuCommander;
    this.currentMenuCommander.attach();
  }
};

/**
 * A content document has unloaded. We need to remove it's menuCommander to
 * avoid leaking it's memory.
 */
GM_BrowserUI.contentUnload = function(e) {
  if (e.persisted) {
    return;
  }

  var unsafeWin = e.target.defaultView;

  // remove the commander for this document
  var commander = null;

  // looping over commanders rather than using getCommander because we need
  // the index into commanders.splice.
  for (var i = 0; item = this.menuCommanders[i]; i++) {
    if (item.win == unsafeWin) {

      if (item.commander == this.currentMenuCommander) {
        this.currentMenuCommander.detach();
        this.currentMenuCommander = null;
      }

      this.menuCommanders.splice(i, 1);

      break;
    }
  }
};

/**
 * The browser XUL has unloaded. We need to let go of the pref watcher so
 * that a non-existant window is not informed when greasemonkey enabled state
 * changes. And we need to let go of the progress listener so that we don't
 * leak it's memory.
 */
GM_BrowserUI.chromeUnload = function() {
  GM_prefRoot.unwatch("enabled", this.enabledWatcher);
  this.tabBrowser.removeProgressListener(this);
  delete this.menuCommanders;
};

/**
 * Called when the content area context menu is showing. We figure out whether
 * to show our context items.
 */
GM_BrowserUI.contextMenuShowing = function() {
  var contextItem = window.document.getElementById("view-userscript");
  var contextSep  = window.document.getElementById("install-userscript-sep");

  var culprit = document.popupNode;

  while (culprit && culprit.tagName && culprit.tagName.toLowerCase() != "a") {
     culprit = culprit.parentNode;
  }

  contextItem.hidden =
    contextSep.hidden =
    !this.getUserScriptLinkUnderPointer();
};


GM_BrowserUI.getUserScriptLinkUnderPointer = function() {
  var culprit = document.popupNode;

  while (culprit && culprit.tagName && culprit.tagName.toLowerCase() != "a") {
     culprit = culprit.parentNode;
  }

  if (!culprit || !culprit.href ||
      !culprit.href.match(/\.user\.js(\?|$)/i)) {
    return null;
  }

  var ioSvc = Components.classes["@mozilla.org/network/io-service;1"]
                        .getService(Components.interfaces.nsIIOService);
  var uri = ioSvc.newURI(culprit.href, null, null);

  return uri;
};

GM_BrowserUI.toolsMenuShowing = function() {
  var installItem = window.document.getElementById("userscript-tools-install");
  var hidden = true;

  if (window._content && window._content.location &&
      window.content.location.href.match(/\.user\.js(\?|$)/i)) {
    hidden = false;
  }

  // Better to use hidden than collapsed because collapsed still allows you to
  // select the item using keyboard navigation, but hidden doesn't.
  installItem.setAttribute("hidden", hidden.toString());
};


/**
 * Helper method which gets the menuCommander corresponding to a given
 * document
 */
GM_BrowserUI.getCommander = function(unsafeWin) {
  for (var i = 0; i < this.menuCommanders.length; i++) {
    if (this.menuCommanders[i].win == unsafeWin) {
      return this.menuCommanders[i].commander;
    }
  }

  // no commander found. create one and add it.
  var commander = new GM_MenuCommander(document);
  this.menuCommanders.push({win:unsafeWin, commander:commander});

  return commander;
};

/**
 * Helper to determine if a given dom window is in this tabbrowser
 */
GM_BrowserUI.isMyWindow = function(domWindow) {
  var tabbrowser = getBrowser();
  var browser;

  for (var i = 0; browser = tabbrowser.browsers[i]; i++) {
    if (browser.contentWindow == domWindow) {
      return true;
    }
  }

  return false;
};

function GM_showGeneralPopup(aEvent) {
  // set the enabled/disabled state
  GM_BrowserUI.generalMenuEnabledItem.setAttribute("checked", GM_getEnabled());
}

function GM_showPopup(aEvent) {
  function urlsOfAllFrames(contentWindow) {
    function collect(contentWindow) {
      urls = urls.concat(urlsOfAllFrames(contentWindow));
    }
    var urls = [contentWindow.location.href];
    Array.prototype.slice.call(contentWindow.frames).forEach(collect);
    return urls;
  }

  function uniq(a) {
    var seen = {}, list = [], item;
    for (var i = 0; i < a.length; i++) {
      item = a[i];
      if (!seen.hasOwnProperty(item))
        seen[item] = list.push(item);
    }
    return list;
  }

  function scriptsMatching(urls) {

    function testMatchURLs(script) {

      function testMatchURL(url) {
        return script.matchesURL(url);
      }

      return urls.some(testMatchURL);
    }

    return GM_getConfig().getMatchingScripts(testMatchURLs);
  }

  function appendScriptToPopup(script) {
    var mi = document.createElement("menuitem");
    mi.setAttribute("label", script.name);
    mi.script = script;
    mi.setAttribute("type", "checkbox");
    mi.setAttribute("checked", script.enabled.toString());
    popup.insertBefore(mi, tail);
  }

  var popup = aEvent.target;
  var tail = document.getElementById("gm-status-no-scripts-sep");

  // set the enabled/disabled state
  GM_BrowserUI.statusEnabledItem.setAttribute("checked", GM_getEnabled());

  // remove all the scripts from the list
  for (var i = popup.childNodes.length - 1; i >= 0; i--) {
    var node = popup.childNodes[i];
    if (node.script || node.getAttribute("value") == "hack") {
      popup.removeChild(node);
    }
  }

  var urls = uniq( urlsOfAllFrames( getBrowser().contentWindow ));
  var runsOnTop = scriptsMatching( [urls.shift()] ); // first url = top window
  var runsFramed = scriptsMatching( urls ); // remainder are all its subframes

  // drop all runsFramed scripts already present in runsOnTop
  for (var i = 0; i < runsOnTop.length; i++) {
    var j = 0, item = runsOnTop[i];
    while (j < runsFramed.length) {
      if (item === runsFramed[j]) {
        runsFramed.splice(j, 1);
      } else {
        j++;
      }
    }
  }

  // build the new list of scripts
  if (runsFramed.length) {
    runsFramed.forEach(appendScriptToPopup);
    if (runsOnTop.length) { // only add the separator if there is stuff below
      var separator = document.createElement("menuseparator");
      separator.setAttribute("value", "hack"); // remove it in the loop above
      popup.insertBefore(separator, tail);
    }
  }
  runsOnTop.forEach(appendScriptToPopup);

  var foundInjectedScript = !!(runsFramed.length + runsOnTop.length);
  document.getElementById("gm-status-no-scripts").collapsed = foundInjectedScript;
}

/**
 * Handle clicking one of the items in the popup. Left-click toggles the enabled
 * state, rihgt-click opens in an editor.
 */
function GM_popupClicked(aEvent) {
  if (aEvent.button == 0 || aEvent.button == 2) {
    var script = aEvent.target.script;
    if (!script) return;

    if (aEvent.button == 0) // left-click: toggle enabled state
      script.enabled =! script.enabled;
    else // right-click: open in editor
      script.edit(window);

    closeMenus(aEvent.target);
  }
}

/**
 * Greasemonkey's enabled state has changed, either as a result of clicking
 * the icon in this window, clicking it in another window, or even changing
 * the mozilla preference that backs it directly.
 */
GM_BrowserUI.refreshStatus = function() {
  if (GM_getEnabled()) {
    this.statusImage.src = "chrome://webmonkey/content/icons/icon_small.png";
    this.statusImage.tooltipText = this.bundle.getString("tooltip.enabled");
  } else {
    this.statusImage.src = "chrome://webmonkey/content/icons/icon_small_disabled.png";
    this.statusImage.tooltipText = this.bundle.getString("tooltip.disabled");
  }

  this.statusImage.style.opacity = "1.0";
};

GM_BrowserUI.newUserScript = function() {
  var windowWatcher = Components
    .classes["@mozilla.org/embedcomp/window-watcher;1"]
    .getService(Components.interfaces.nsIWindowWatcher);
  windowWatcher.openWindow(
    window, "chrome://webmonkey/content/newscript.xul", null,
    "chrome,dependent,centerscreen,resizable,dialog", null
  );
};

GM_BrowserUI.showStatus = function(message, autoHide) {
  if (this.statusLabel.collapsed) {
    this.statusLabel.collapsed = false;
  }

  message += " ";

  var box = document.createElement("vbox");
  var label = document.createElement("label");
  box.style.position = "fixed";
  box.style.left = "-10000px";
  box.style.top = "-10000px";
  box.style.border = "5px solid red";
  box.appendChild(label);
  document.documentElement.appendChild(box);
  label.setAttribute("value", message);

  var current = parseInt(this.statusLabel.style.width);
  this.statusLabel.value = message;
  var max = label.boxObject.width;

  this.showAnimation = new Accelimation(this.statusLabel.style,
                                          "width", max, 300, 2, "px");
  this.showAnimation.onend = GM_hitch(this, "showStatusAnimationEnd", autoHide);
  this.showAnimation.start();
};

GM_BrowserUI.showStatusAnimationEnd = function(autoHide) {
  this.showAnimation = null;

  if (autoHide) {
    this.setAutoHideTimer();
  }
};

GM_BrowserUI.setAutoHideTimer = function() {
  if (this.autoHideTimer) {
    window.clearTimeout(this.autoHideTimer);
  }

  this.autoHideTimer = window.setTimeout(GM_hitch(this, "hideStatus"), 3000);
};

GM_BrowserUI.hideStatusImmediately = function() {
  if (this.showAnimation) {
    this.showAnimation.stop();
    this.showAnimation = null;
  }

  if (this.hideAnimation) {
    this.hideAnimation.stop();
    this.hideAnimation = null;
  }

  if (this.autoHideTimer) {
    window.clearTimeout(this.autoHideTimer);
    this.autoHideTimer = null;
  }

  this.statusLabel.style.width = "0";
  this.statusLabel.collapsed = true;
};

GM_BrowserUI.hideStatus = function() {
  if (!this.hideAnimation) {
    this.autoHideTimer = null;
    this.hideAnimation = new Accelimation(this.statusLabel.style,
                                            "width", 0, 300, 2, "px");
    this.hideAnimation.onend = GM_hitch(this, "hideStatusAnimationEnd");
    this.hideAnimation.start();
  }
};

GM_BrowserUI.hideStatusAnimationEnd = function() {
  this.hideAnimation = null;
  this.statusLabel.collapsed = true;
};

// necessary for webProgressListener implementation
GM_BrowserUI.onProgressChange = function(webProgress,b,c,d,e,f){};
GM_BrowserUI.onStateChange = function(a,b,c,d){};
GM_BrowserUI.onStatusChange = function(a,b,c,d){};
GM_BrowserUI.onSecurityChange = function(a,b,c){};
GM_BrowserUI.onLinkIconAvailable = function(a){};

GM_BrowserUI.showHorrayMessage = function(scriptName) {
  this.showStatus("'" + scriptName + "' " + this.bundle.getString("statusbar.installed"), true);
};

GM_BrowserUI.installMenuItemClicked = function() {
  GM_BrowserUI.installCurrentScript();
};

GM_BrowserUI.viewContextItemClicked = function() {
  var uri = GM_BrowserUI.getUserScriptLinkUnderPointer();
  this.downloadScript(uri, false);
};

GM_BrowserUI.manageMenuItemClicked = function() {
  var manage = Components.classes["@mozilla.org/appshell/window-mediator;1"]
               .getService(Components.interfaces.nsIWindowMediator)
               .getMostRecentWindow("Greasemonkey:Manage");
  if (manage) return manage.focus();
  var win = (!window.opener || window.opener.closed) ? window : window.opener;
  win.openDialog("chrome://webmonkey/content/manage.xul",
                 "_blank", "resizable,dialog=no,centerscreen");
};

log("calling init...");
GM_BrowserUI.init();
