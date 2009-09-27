/**
 * @fileoverview Implementation of userscript API XmlHttpRequest.
 */
// JSM exported symbols
var EXPORTED_SYMBOLS = ["ScriptApiXmlHttpRequest"];


const Cc = Components.classes;
const Ci = Components.interfaces;

const IO      = Cc["@mozilla.org/network/io-service;1"]
                   .getService(Ci.nsIIOService);
const SHELL   = Cc["@mozilla.org/appshell/appShellService;1"]
                   .getService(Ci.nsIAppShellService);


/**
 * Construct a new XMLHttpRequest object.
 * @constructor
 * @param unsafeWin    Parent window.
 *
 * @class   Implementation of the GM_xmlhttpRequest logic.
 */
ScriptApiXmlHttpRequest = function(/**nsIDOMWindow*/ unsafeWin) {
  this.unsafeWin = unsafeWin;
  this.chromeWin = SHELL.hiddenDOMWindow;
}

ScriptApiXmlHttpRequest.prototype = {
  //this function gets called by user scripts in content security scope to
  //start a cross-domain xmlhttp request.
  //
  //details should look like:
  //{method,url,onload,onerror,onreadystatechange,headers,data}
  //headers should be in the form {name:value,name:value,etc}
  //can't support mimetype because i think it's only used for forcing
  //text/xml and we can't support that
  contentStartRequest: function(details) {
    // important to store this locally so that content cannot trick us up with
    // a fancy getter that checks the number of times it has been accessed,
    // returning a dangerous URL the time that we actually use it.
    var url = details.url;
    if (typeof url != "string")
      throw new Error("Invalid url: url must be of type string");
    var scheme = IO.extractScheme(url);
    switch (scheme) {
      case "http":
      case "https":
      case "ftp":
        this.chromeWin.setTimeout(
          bind(this, "_chromeStartRequest", url, details), 0);
        break;
      default:
        throw new Error("Invalid url: " + url);
    }
  },

  // this function is intended to be called in chrome's security context, so
  // that it can access other domains without security warning
  _chromeStartRequest: function(safeUrl, details) {
    var req = new this.chromeWin.XMLHttpRequest();
    this._setupRequestEvent(this.unsafeWin, req, "onload", details);
    this._setupRequestEvent(this.unsafeWin, req, "onerror", details);
    this._setupRequestEvent(this.unsafeWin, req, "onreadystatechange", details);
    req.open(details.method, safeUrl);
    if (details.overrideMimeType)
      req.overrideMimeType(details.overrideMimeType);
  
    if (details.headers)
      for (var prop in details.headers)
        req.setRequestHeader(prop, details.headers[prop]);
  
    if (details.nocache)
      try {
        req.channel.loadFlags |= Ci.nsIRequest.LOAD_BYPASS_CACHE;
      } catch (e) {
        throw new Error("Could not set 'bypass cache' option");
      }
  
    var body = details.data ? details.data : null;
    if (details.binary)
      req.sendAsBinary(body);
    else
      req.send(body);
  },

  // arranges for the specified 'event' on xmlhttprequest 'req' to call the
  // method by the same name which is a property of 'details' in the content
  // window's security context.
  _setupRequestEvent: function(unsafeWin, req, event, details) {
    if (!details[event])
      return;
    req[event] = function() {
      var responseState = {
        // can't support responseXML because security won't
        // let the browser call properties on it
        responseText:    req.responseText,
        readyState:      req.readyState,
        responseHeaders:(req.readyState == 4 && event != "onerror" ?
                         req.getAllResponseHeaders() :
                         ""),
        status:         (req.readyState == 4 ? req.status : 0),
        statusText:     (req.readyState == 4 && event != "onerror" ?
                        req.statusText : ""),
        finalUrl:       (req.readyState == 4 ? req.channel.URI.spec : "")
      }
      // Pop back onto browser thread and call event handler.
      // Have to use nested function here instead of GM_hitch because
      // otherwise details[event].apply can point to window.setTimeout, which
      // can be abused to get increased priveleges.
      new XPCNativeWrapper(unsafeWin, "setTimeout()")
        .setTimeout(function() { details[event](responseState); }, 0);
    }
  }
}


function bind(/**Object*/ object, /**string*/ method) {
  var staticArgs = Array.prototype.splice.call(arguments, 2, arguments.length);
  return function() {
    var args = staticArgs.concat();
    for (var i = 0; i < arguments.length; i++)
      args.push(arguments[i]);
    return object[method].apply(object, args);
  };
}

